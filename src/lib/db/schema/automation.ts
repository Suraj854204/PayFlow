import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { users } from "./auth";
import { organizations } from "./tenancy";

const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export type TriggerKind =
  "leave.applied" | "payroll.approved" | "employee.joined" | "deadline.near";
export interface WorkflowNode {
  id: string;
  type: "trigger" | "condition" | "action";
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Condition and approval nodes branch: "true"/"false" or "approved"/"rejected". */
  sourceHandle?: string | null;
}
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
export interface RunStep {
  nodeId: string;
  label: string;
  status: "succeeded" | "failed" | "skipped" | "waiting";
  note?: string;
  attempts: number;
  at: string;
}

/** A visual automation: one trigger, optional conditions, and actions. Soft-deleted. */
export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(false),
    triggerKind: text("trigger_kind").$type<TriggerKind>().notNull(),
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    templateKey: text("template_key"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("workflows_trigger_idx").on(t.organizationId, t.triggerKind, t.enabled),
    check(
      "workflows_trigger_kind",
      sql`${t.triggerKind} in ('leave.applied','payroll.approved','employee.joined','deadline.near')`,
    ),
  ],
);

/** One execution of a workflow, with a step-by-step log. `dedupeKey` makes triggers idempotent. */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: id(),
    organizationId: orgRef(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    triggerKind: text("trigger_kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("queued"),
    steps: jsonb("steps").$type<RunStep[]>().notNull().default([]),
    /** When paused on an approval step: the node to resume from once decided. */
    waitingNodeId: text("waiting_node_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    dedupeKey: text("dedupe_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("workflow_runs_wf_idx").on(t.organizationId, t.workflowId, t.createdAt),
    uniqueIndex("workflow_runs_dedupe_uq")
      .on(t.workflowId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    check(
      "workflow_runs_status",
      sql`${t.status} in ('queued','running','waiting','succeeded','failed','cancelled')`,
    ),
  ],
);

/** Tasks created by workflows: plain to-dos, and approval steps that resume the workflow when decided. */
export const workflowTasks = pgTable(
  "workflow_tasks",
  {
    id: id(),
    organizationId: orgRef(),
    runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id"),
    kind: text("kind").notNull().default("task"),
    title: text("title").notNull(),
    detail: text("detail"),
    /** Role that may act on it, e.g. "hr_admin". Null means any admin. */
    assigneeRole: text("assignee_role"),
    status: text("status").notNull().default("open"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("workflow_tasks_open_idx").on(t.organizationId, t.status, t.createdAt),
    check("workflow_tasks_kind", sql`${t.kind} in ('task','approval')`),
    check(
      "workflow_tasks_status",
      sql`${t.status} in ('open','done','approved','rejected','cancelled')`,
    ),
  ],
);

/** A key for the public API. Only a hash is stored; the full key is shown once at creation. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_org_idx").on(t.organizationId, t.createdAt),
    check("api_keys_rate", sql`${t.rateLimitPerMin} between 1 and 1000`),
  ],
);

/** Where signed event payloads are POSTed. The signing secret is encrypted at rest. */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    organizationId: orgRef(),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    events: text("events").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.organizationId, t.enabled)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    organizationId: orgRef(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_ep_idx").on(t.organizationId, t.endpointId, t.createdAt),
    check("webhook_deliveries_status", sql`${t.status} in ('pending','delivered','failed')`),
  ],
);

/** Per-company settings for the automatic payroll pipeline. */
export const payrollPipelines = pgTable(
  "payroll_pipelines",
  {
    id: id(),
    organizationId: orgRef(),
    enabled: boolean("enabled").notNull().default(false),
    /** Day of the month (IST) the pipeline starts for the previous month. */
    startDay: integer("start_day").notNull().default(1),
    reminderHours: integer("reminder_hours").notNull().default(24),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payroll_pipelines_org_uq").on(t.organizationId),
    check("payroll_pipelines_day", sql`${t.startDay} between 1 and 28`),
  ],
);

/** What the pipeline has done for a month, one row per step, so reruns never repeat a step. */
export const pipelineSteps = pgTable(
  "pipeline_steps",
  {
    id: id(),
    organizationId: orgRef(),
    month: text("month").notNull(),
    step: text("step").notNull(),
    status: text("status").notNull(),
    detail: text("detail"),
    count: integer("count").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pipeline_steps_uq").on(t.organizationId, t.month, t.step),
    check("pipeline_steps_status", sql`${t.status} in ('done','blocked','skipped','failed')`),
  ],
);
