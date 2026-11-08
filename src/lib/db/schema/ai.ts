import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { users } from "./auth";
import { payrollRuns } from "./payroll";
import { organizations } from "./tenancy";

const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export interface ChatSource {
  title: string;
  detail?: string;
  href?: string;
}
export interface ChatChart {
  kind: "bar" | "line" | "donut";
  title: string;
  /** Plain numbers in `unit`: "inr" values are paise, "count" and "percent" are as shown. */
  unit: "inr" | "count" | "percent";
  points: { label: string; value: number }[];
}

/** A conversation. Visible only to the user who started it (queries always filter by user). */
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: id(),
    organizationId: orgRef(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => [index("chat_sessions_user_idx").on(t.organizationId, t.userId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    organizationId: orgRef(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources").$type<ChatSource[]>().notNull().default([]),
    chart: jsonb("chart").$type<ChatChart | null>(),
    /** "model" when Gemini answered, "fallback" when the built-in engine did. */
    engine: text("engine"),
    /** 1 = thumbs up, -1 = thumbs down. */
    feedback: smallint("feedback"),
    /** An action the assistant proposed in this reply; its card shows the live status. */
    actionId: uuid("action_id"),
    ...timestamps,
  },
  (t) => [
    index("chat_messages_session_idx").on(t.sessionId, t.createdAt),
    check("chat_messages_role", sql`${t.role} in ('user','assistant')`),
    check("chat_messages_feedback", sql`${t.feedback} is null or ${t.feedback} in (-1, 1)`),
    check("chat_messages_len", sql`char_length(${t.content}) <= 20000`),
  ],
);

/** One row per model call (or refused attempt): tokens and an estimated cost for budgeting. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    organizationId: orgRef(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Estimated, in millionths of a US dollar. */
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    status: text("status").notNull(),
    ...timestamps,
  },
  (t) => [
    index("ai_usage_user_day_idx").on(t.organizationId, t.userId, t.createdAt),
    check(
      "ai_usage_status",
      sql`${t.status} in ('ok','fallback','error','blocked','rate_limited','budget')`,
    ),
  ],
);

/** An HR/Finance decision that an anomaly on a run is expected, with the reason on record. */
export const anomalyDismissals = pgTable(
  "anomaly_dismissals",
  {
    id: id(),
    organizationId: orgRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    reason: text("reason").notNull(),
    dismissedBy: text("dismissed_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("anomaly_dismissals_uq").on(t.runId, t.key),
    check("anomaly_dismissals_reason", sql`char_length(${t.reason}) >= 3`),
  ],
);

export type AiActionKind =
  | "approve_leave"
  | "reject_leave"
  | "create_payroll_draft"
  | "department_raise"
  | "cancel_payroll_run";
export type AiActionStatus =
  "pending" | "executing" | "executed" | "failed" | "cancelled" | "expired";
export interface AiActionChange {
  label: string;
  before?: string;
  after: string;
}
export interface AiActionPreview {
  title: string;
  summary: string;
  changes: AiActionChange[];
  warnings: string[];
}

/**
 * Something the assistant proposed to do. The parameters are fixed server-side when it is proposed
 * and the user can only confirm or cancel: they cannot be altered at confirmation time.
 */
export const aiActions = pgTable(
  "ai_actions",
  {
    id: id(),
    organizationId: orgRef(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => chatSessions.id, { onDelete: "set null" }),
    kind: text("kind").$type<AiActionKind>().notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    preview: jsonb("preview").$type<AiActionPreview>().notNull(),
    destructive: smallint("destructive").notNull().default(0),
    status: text("status").$type<AiActionStatus>().notNull().default("pending"),
    result: text("result"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ai_actions_user_idx").on(t.organizationId, t.userId, t.createdAt),
    check(
      "ai_actions_status",
      sql`${t.status} in ('pending','executing','executed','failed','cancelled','expired')`,
    ),
    check("ai_actions_destructive", sql`${t.destructive} in (0, 1)`),
  ],
);
