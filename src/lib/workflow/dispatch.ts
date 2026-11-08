import "server-only";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, withTenant } from "@/lib/db";
import {
  memberships,
  webhookDeliveries,
  webhookEndpoints,
  workflowRuns,
  workflows,
  type RunStep,
  type TriggerKind,
  type WorkflowDefinition,
} from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { notify } from "@/lib/notify";
import { buildExecutor } from "./executors";
import { runWorkflow } from "./engine";
import { safePost } from "./ssrf";
import { signatureHeaders } from "./signing";

export { WEBHOOK_EVENTS } from "./events";
const MAX_DELIVERY_ATTEMPTS = 6;
/** 1m, 5m, 30m, 2h, 8h between attempts. */
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];

export interface EmitResult {
  runIds: string[];
  deliveryIds: string[];
}

/**
 * Records that something happened. Matching workflows get a queued run and subscribed webhook
 * endpoints get a pending delivery, all in one transaction so nothing is half-recorded. The
 * optional `dedupeKey` makes re-emitting the same event (e.g. a daily deadline sweep) a no-op.
 */
export async function emitEvent(
  orgId: string,
  kind: TriggerKind | "payroll.paid",
  payload: Record<string, unknown>,
  dedupeKey?: string,
): Promise<EmitResult> {
  if (dedupeKey) payload = { ...payload, dedupeKey };
  const result = await withTenant(orgId, async (tx) => {
    const runIds: string[] = [];
    const deliveryIds: string[] = [];
    if (kind !== "payroll.paid") {
      const wfs = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(
          and(
            eq(workflows.organizationId, orgId),
            eq(workflows.triggerKind, kind),
            eq(workflows.enabled, true),
            isNull(workflows.deletedAt),
          ),
        );
      for (const w of wfs) {
        const [run] = await tx
          .insert(workflowRuns)
          .values({
            organizationId: orgId,
            workflowId: w.id,
            triggerKind: kind,
            payload,
            dedupeKey: dedupeKey ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: workflowRuns.id });
        if (run) runIds.push(run.id);
      }
    }
    const eps = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, orgId),
          eq(webhookEndpoints.enabled, true),
          isNull(webhookEndpoints.deletedAt),
          sql`${kind} = any(${webhookEndpoints.events})`,
        ),
      );
    for (const ep of eps) {
      // With a dedupe key, an endpoint hears about the same thing only once.
      if (dedupeKey) {
        const [dup] = await tx
          .select({ id: webhookDeliveries.id })
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.endpointId, ep.id),
              eq(webhookDeliveries.event, kind),
              sql`${webhookDeliveries.payload}->>'dedupeKey' = ${dedupeKey}`,
            ),
          )
          .limit(1);
        if (dup) continue;
      }
      {
        const [d] = await tx
          .insert(webhookDeliveries)
          .values({ organizationId: orgId, endpointId: ep.id, event: kind, payload })
          .returning({ id: webhookDeliveries.id });
        deliveryIds.push(d.id);
      }
    }
    return { runIds, deliveryIds };
  });
  await scheduleWork(orgId, result);
  return result;
}

/**
 * Hands work to Inngest when it is configured (durable, retried by Inngest). Otherwise runs it
 * right after the response. Either way the rows are the source of truth, and `tick()` picks up
 * anything that was missed, so a crash cannot lose a run.
 */
export async function scheduleWork(orgId: string, work: EmitResult) {
  if (work.runIds.length === 0 && work.deliveryIds.length === 0) return;
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      const { inngest } = await import("@/inngest/client");
      await inngest.send([
        ...work.runIds.map((runId) => ({ name: "payflow/workflow.run", data: { orgId, runId } })),
        ...work.deliveryIds.map((deliveryId) => ({
          name: "payflow/webhook.deliver",
          data: { orgId, deliveryId },
        })),
      ]);
      return;
    } catch (e) {
      console.error("Inngest send failed, running inline", e);
    }
  }
  const inline = async () => {
    for (const runId of work.runIds) await processRun(orgId, runId).catch(logErr);
    for (const deliveryId of work.deliveryIds)
      await deliverWebhook(orgId, deliveryId).catch(logErr);
  };
  try {
    const { after } = await import("next/server");
    after(inline);
  } catch {
    // Outside a request (cron, tests): just run it.
    await inline();
  }
}

const logErr = (e: unknown) => console.error("[automation]", e);

/** Executes (or resumes) one run. Safe to call twice: finished runs are left alone. */
export async function processRun(
  orgId: string,
  runId: string,
  decision?: { nodeId: string; approved: boolean },
) {
  const run = await withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        payload: workflowRuns.payload,
        steps: workflowRuns.steps,
        attempts: workflowRuns.attempts,
        definition: workflows.definition,
        name: workflows.name,
      })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(eq(workflowRuns.id, runId))
      .for("update", { of: workflowRuns });
    if (!row) return null;
    const runnable = decision
      ? row.status === "waiting"
      : ["queued", "failed"].includes(row.status);
    if (!runnable) return null;
    await tx
      .update(workflowRuns)
      .set({
        status: "running",
        startedAt: sql`coalesce(started_at, now())`,
        attempts: row.attempts + 1,
      })
      .where(eq(workflowRuns.id, runId));
    return row;
  });
  if (!run) return;

  let result;
  try {
    result = await runWorkflow({
      definition: run.definition as WorkflowDefinition,
      payload: run.payload,
      previous: run.steps as RunStep[],
      decision,
      exec: buildExecutor(orgId, runId),
    });
  } catch (e) {
    result = {
      status: "failed" as const,
      steps: run.steps as RunStep[],
      error: e instanceof Error ? e.message : "Unexpected error",
      waitingNodeId: undefined,
    };
  }

  await withTenant(orgId, async (tx) => {
    await tx
      .update(workflowRuns)
      .set({
        status: result.status,
        steps: result.steps,
        error: result.status === "failed" ? (result.error ?? "Failed") : null,
        waitingNodeId: result.status === "waiting" ? (result.waitingNodeId ?? null) : null,
        finishedAt: result.status === "waiting" ? null : new Date(),
      })
      .where(eq(workflowRuns.id, runId));
    if (result.status === "failed") {
      const admins = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.isActive, true),
            inArray(memberships.role, ["super_admin", "hr_admin"]),
          ),
        );
      for (const a of admins)
        await notify(tx, orgId, {
          userId: a.userId,
          type: "workflow_failed",
          title: `Automation failed: ${run.name}`,
          body: result.error ?? undefined,
          href: "/workflows",
        });
    }
  });
}

/** One signed delivery attempt with exponential backoff. Gives up after MAX_DELIVERY_ATTEMPTS. */
export async function deliverWebhook(orgId: string, deliveryId: string) {
  const row = await withTenant(orgId, async (tx) => {
    const [r] = await tx
      .select({
        id: webhookDeliveries.id,
        event: webhookDeliveries.event,
        payload: webhookDeliveries.payload,
        attempts: webhookDeliveries.attempts,
        status: webhookDeliveries.status,
        url: webhookEndpoints.url,
        secretEnc: webhookEndpoints.secretEnc,
        enabled: webhookEndpoints.enabled,
        deleted: webhookEndpoints.deletedAt,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(eq(webhookDeliveries.id, deliveryId))
      .for("update", { of: webhookDeliveries });
    return r;
  });
  if (!row || row.status !== "pending") return;
  if (!row.enabled || row.deleted) {
    await withTenant(orgId, (tx) =>
      tx
        .update(webhookDeliveries)
        .set({ status: "failed", lastError: "Endpoint disabled or removed" })
        .where(eq(webhookDeliveries.id, deliveryId)),
    );
    return;
  }

  const body = JSON.stringify({
    id: deliveryId,
    event: row.event,
    createdAt: new Date().toISOString(),
    data: row.payload,
  });
  let status: number | null = null;
  let error: string | null = null;
  try {
    const r = await safePost(row.url, body, {
      ...signatureHeaders(decrypt(row.secretEnc), body),
      "x-payflow-event": row.event,
      "x-payflow-delivery": deliveryId,
    });
    status = r.status;
    if (!r.ok) error = `Receiver answered HTTP ${r.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : "Delivery failed";
  }

  const attempts = row.attempts + 1;
  await withTenant(orgId, (tx) =>
    tx
      .update(webhookDeliveries)
      .set(
        error === null
          ? {
              status: "delivered",
              attempts,
              responseStatus: status,
              lastError: null,
              deliveredAt: new Date(),
            }
          : attempts >= MAX_DELIVERY_ATTEMPTS
            ? { status: "failed", attempts, responseStatus: status, lastError: error }
            : {
                attempts,
                responseStatus: status,
                lastError: error,
                nextAttemptAt: new Date(
                  Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
                ),
              },
      )
      .where(eq(webhookDeliveries.id, deliveryId)),
  );
}

/**
 * The sweep that makes everything self-healing: queued runs that never started and deliveries
 * that are due for a retry. Called by Inngest's cron or by GET /api/cron/tick.
 */
export async function tick(): Promise<{ runs: number; deliveries: number }> {
  const orgs = (await db.execute(sql`select automation_org_ids() as id`)).rows as { id: string }[];
  let runs = 0;
  for (const { id: orgId } of orgs) {
    const queued = await withTenant(orgId, (tx) =>
      tx
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.status, "queued"),
            lte(workflowRuns.createdAt, new Date(Date.now() - 30_000)),
          ),
        )
        .orderBy(asc(workflowRuns.createdAt))
        .limit(50),
    );
    for (const r of queued) {
      await processRun(orgId, r.id).catch(logErr);
      runs++;
    }
  }
  const due = (await db.execute(sql`select id, organization_id from due_webhook_deliveries(100)`))
    .rows as { id: string; organization_id: string }[];
  for (const d of due) await deliverWebhook(d.organization_id, d.id).catch(logErr);
  return { runs, deliveries: due.length };
}
