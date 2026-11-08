import { z } from "zod";
import type { TriggerKind, WorkflowDefinition } from "@/lib/db/schema";

export const TRIGGERS: Record<
  TriggerKind,
  { label: string; fields: { path: string; label: string }[] }
> = {
  "leave.applied": {
    label: "Leave applied",
    fields: [
      { path: "leave.days", label: "Days requested" },
      { path: "leave.type", label: "Leave type" },
      { path: "leave.from", label: "From date" },
      { path: "employee.name", label: "Employee name" },
      { path: "employee.department", label: "Department" },
    ],
  },
  "payroll.approved": {
    label: "Payroll approved",
    fields: [
      { path: "run.month", label: "Month (YYYY-MM)" },
      { path: "run.monthLabel", label: "Month" },
      { path: "run.employees", label: "Employees paid" },
      { path: "run.totalNetInr", label: "Total net pay (₹)" },
      { path: "run.totalNet", label: "Total net pay (paise)" },
    ],
  },
  "employee.joined": {
    label: "Employee joined",
    fields: [
      { path: "employee.name", label: "Employee name" },
      { path: "employee.department", label: "Department" },
      { path: "employee.designation", label: "Designation" },
      { path: "employee.joinDate", label: "Join date" },
    ],
  },
  "deadline.near": {
    label: "Deadline near",
    fields: [
      { path: "deadline.label", label: "Deadline" },
      { path: "deadline.dueDate", label: "Due date" },
      { path: "deadline.daysLeft", label: "Days left" },
    ],
  },
};
export const TRIGGER_KINDS = Object.keys(TRIGGERS) as TriggerKind[];

export const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;
export type Op = (typeof OPS)[number];

const role = z.enum(["hr_admin", "finance", "super_admin"]);
const text = (max: number) => z.string().trim().min(1).max(max);

export const ACTION_TYPES = [
  "email",
  "slack",
  "teams",
  "whatsapp",
  "webhook",
  "approval",
  "task",
  "notify",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ACTION_LABEL: Record<ActionType, string> = {
  email: "Send email",
  slack: "Post to Slack",
  teams: "Post to Teams",
  whatsapp: "Send WhatsApp",
  webhook: "Call webhook",
  approval: "Ask for approval",
  task: "Create task",
  notify: "In-app notification",
};

export const ACTION_CONFIG = {
  email: z.object({
    to: z.enum(["employee", "hr", "custom"]),
    customEmail: z.string().trim().email().optional(),
    subject: text(150),
    body: text(3000),
  }),
  slack: z.object({ url: z.string().trim().url(), message: text(2000) }),
  teams: z.object({ url: z.string().trim().url(), message: text(2000) }),
  whatsapp: z.object({
    to: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{10,15}$/, "Phone with country code"),
    message: text(1000),
  }),
  webhook: z.object({
    url: z.string().trim().url(),
    message: z.string().trim().max(500).optional(),
  }),
  approval: z.object({ title: text(150), assigneeRole: role }),
  task: z.object({
    title: text(150),
    assigneeRole: role.optional(),
    detail: z.string().trim().max(500).optional(),
  }),
  notify: z.object({
    audience: z.enum(["employee", "hr"]),
    title: text(120),
    body: z.string().trim().max(400).optional(),
  }),
} as const;

export const conditionSchema = z.object({
  field: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_.]+$/),
  op: z.enum(OPS),
  value: z.union([z.string().max(100), z.number()]),
});

export const MAX_NODES = 30;

export interface DefinitionIssue {
  nodeId?: string;
  message: string;
}

/** Checks the graph is runnable: one trigger, known node types, valid configs, no cycles, nothing orphaned. */
export function validateDefinition(def: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const add = (message: string, nodeId?: string) => issues.push({ message, nodeId });
  if (def.nodes.length > MAX_NODES) add(`A workflow can have at most ${MAX_NODES} steps.`);
  const ids = new Set(def.nodes.map((n) => n.id));
  if (ids.size !== def.nodes.length) add("Step ids must be unique.");
  const triggers = def.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) add("A workflow needs exactly one trigger.");
  const approvals = def.nodes.filter((n) => n.type === "action" && n.data.action === "approval");
  if (approvals.length > 1) add("Only one approval step is supported per workflow.");
  for (const n of def.nodes) {
    if (n.type === "trigger") {
      if (!TRIGGER_KINDS.includes(n.data.kind as TriggerKind)) add("Choose a trigger.", n.id);
    } else if (n.type === "condition") {
      if (!conditionSchema.safeParse(n.data).success) add("Complete the condition.", n.id);
    } else {
      const a = n.data.action as ActionType;
      const schema = ACTION_CONFIG[a];
      if (!schema) add("Choose an action.", n.id);
      else {
        const r = schema.safeParse(n.data.config ?? {});
        if (!r.success) add(r.error.issues[0]?.message ?? "Complete this step.", n.id);
        else if (
          a === "email" &&
          (r.data as { to: string; customEmail?: string }).to === "custom" &&
          !(r.data as { customEmail?: string }).customEmail
        )
          add("Enter the email address.", n.id);
      }
    }
  }
  for (const e of def.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) add("A connection points at a missing step.");
  }
  // Reachability and cycles from the trigger.
  const trig = triggers[0];
  if (trig) {
    const out = new Map<string, string[]>();
    for (const e of def.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    const seen = new Set<string>();
    const stack = new Set<string>();
    let cyclic = false;
    const walk = (id: string) => {
      if (stack.has(id)) return void (cyclic = true);
      if (seen.has(id)) return;
      seen.add(id);
      stack.add(id);
      for (const t of out.get(id) ?? []) walk(t);
      stack.delete(id);
    };
    walk(trig.id);
    if (cyclic) add("Connections cannot loop back.");
    for (const n of def.nodes)
      if (!seen.has(n.id)) add("This step is not connected to the trigger.", n.id);
    if (def.nodes.length === 1) add("Add at least one step after the trigger.", trig.id);
    else if (!def.edges.some((e) => e.source === trig.id))
      add("Connect the trigger to a step.", trig.id);
  }
  return issues;
}

export const triggerOf = (def: WorkflowDefinition): TriggerKind | null => {
  const t = def.nodes.find((n) => n.type === "trigger");
  const k = t?.data.kind as TriggerKind | undefined;
  return k && TRIGGER_KINDS.includes(k) ? k : null;
};
