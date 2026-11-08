import type { RunStep, WorkflowDefinition, WorkflowNode } from "@/lib/db/schema";
import { ACTION_LABEL, type ActionType } from "./model";

export type Json = Record<string, unknown>;

export const pick = (obj: Json, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);

/** Replaces {{path}} with values from the event. Unknown paths become empty, never "undefined". */
export function interpolate(text: string, payload: Json): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, p: string) => {
    const v = pick(payload, p);
    return v === undefined || v === null || typeof v === "object" ? "" : String(v);
  });
}

export function evalCondition(
  c: { field: string; op: string; value: string | number },
  payload: Json,
): boolean {
  const left = pick(payload, c.field);
  if (left === undefined || left === null) return false;
  const ln = Number(left);
  const rn = Number(c.value);
  const numeric =
    !Number.isNaN(ln) &&
    !Number.isNaN(rn) &&
    String(left).trim() !== "" &&
    String(c.value).trim() !== "";
  switch (c.op) {
    case "eq":
      return numeric ? ln === rn : String(left).toLowerCase() === String(c.value).toLowerCase();
    case "neq":
      return numeric ? ln !== rn : String(left).toLowerCase() !== String(c.value).toLowerCase();
    case "gt":
      return numeric && ln > rn;
    case "gte":
      return numeric && ln >= rn;
    case "lt":
      return numeric && ln < rn;
    case "lte":
      return numeric && ln <= rn;
    case "contains":
      return String(left).toLowerCase().includes(String(c.value).toLowerCase());
    default:
      return false;
  }
}

export interface ActionOutcome {
  status: "ok" | "skipped";
  note?: string;
  /** Set by the approval executor: the run pauses until a person decides. */
  waiting?: boolean;
}
export type Executor = (
  action: ActionType,
  config: Record<string, unknown>,
  ctx: { payload: Json; node: WorkflowNode },
) => Promise<ActionOutcome>;

export interface RunResult {
  status: "succeeded" | "failed" | "waiting";
  steps: RunStep[];
  waitingNodeId?: string;
  error?: string;
}

export const MAX_ATTEMPTS = 3;

/**
 * Runs a workflow graph from its trigger (or resumes after an approval). Steps that already
 * succeeded in `previous` are not repeated, so a retry never sends an email twice. A failing action
 * is retried; if it still fails the run stops there and the failure is recorded.
 */
export async function runWorkflow(opts: {
  definition: WorkflowDefinition;
  payload: Json;
  previous?: RunStep[];
  /** Resuming: the decision on the approval step. */
  decision?: { nodeId: string; approved: boolean };
  exec: Executor;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}): Promise<RunResult> {
  const { definition: def, payload, exec } = opts;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const steps: RunStep[] = [...(opts.previous ?? [])].filter((s) => s.status !== "waiting");
  const done = new Set(
    steps.filter((s) => s.status === "succeeded" || s.status === "skipped").map((s) => s.nodeId),
  );
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const edgesFrom = (id: string, handle?: string) =>
    def.edges.filter(
      (e) => e.source === id && (handle === undefined || (e.sourceHandle ?? "true") === handle),
    );
  const label = (n: WorkflowNode) =>
    n.type === "trigger"
      ? "Trigger"
      : n.type === "condition"
        ? "Condition"
        : (ACTION_LABEL[n.data.action as ActionType] ?? "Action");
  const log = (n: WorkflowNode, status: RunStep["status"], attempts: number, note?: string) =>
    steps.push({ nodeId: n.id, label: label(n), status, attempts, note, at: now().toISOString() });

  const trigger = def.nodes.find((n) => n.type === "trigger");
  if (!trigger) return { status: "failed", steps, error: "The workflow has no trigger." };

  const ready: string[] = [];
  const visited = new Set<string>();
  const push = (id: string) => {
    if (!visited.has(id)) {
      visited.add(id);
      ready.push(id);
    }
  };
  if (opts.decision) {
    // Resume: replay already-succeeded steps silently to rebuild the path, then continue past the approval.
    done.add(opts.decision.nodeId);
    for (const e of edgesFrom(
      opts.decision.nodeId,
      opts.decision.approved ? "approved" : "rejected",
    ))
      push(e.target);
    visited.add(trigger.id);
    // Branches that were not finished before the pause continue too.
    for (const n of def.nodes) if (done.has(n.id)) visited.add(n.id);
  } else push(trigger.id);

  while (ready.length) {
    // Approval steps wait until every other ready step has run, so nothing is left half done.
    const idx = ready.findIndex((id) => byId.get(id)?.data.action !== "approval");
    const id = ready.splice(idx === -1 ? 0 : idx, 1)[0];
    const n = byId.get(id)!;
    if (n.type === "trigger") {
      if (!done.has(id)) log(n, "succeeded", 1);
      for (const e of edgesFrom(id)) push(e.target);
      continue;
    }
    if (n.type === "condition") {
      const result = evalCondition(
        n.data as { field: string; op: string; value: string | number },
        payload,
      );
      if (!done.has(id))
        log(
          n,
          "succeeded",
          1,
          `${String(n.data.field)} ${String(n.data.op)} ${String(n.data.value)} → ${result ? "yes" : "no"}`,
        );
      for (const e of edgesFrom(id, result ? "true" : "false")) push(e.target);
      continue;
    }
    if (done.has(id)) {
      for (const e of edgesFrom(id)) push(e.target);
      continue;
    }
    const action = n.data.action as ActionType;
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const out = await exec(action, (n.data.config ?? {}) as Record<string, unknown>, {
          payload,
          node: n,
        });
        if (out.waiting) {
          log(n, "waiting", attempt, out.note);
          return { status: "waiting", steps, waitingNodeId: n.id };
        }
        log(n, out.status === "skipped" ? "skipped" : "succeeded", attempt, out.note);
        for (const e of edgesFrom(id)) push(e.target);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Action failed";
        if (attempt >= MAX_ATTEMPTS) {
          log(n, "failed", attempt, msg);
          return { status: "failed", steps, error: `${label(n)}: ${msg}` };
        }
        await sleep(200 * 4 ** (attempt - 1));
      }
    }
  }
  return { status: "succeeded", steps };
}
