import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { users } from "./auth";
import { employees } from "./hr";
import { loans } from "./payroll";
import { departments, designations, organizations } from "./tenancy";

const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const empRef = (name = "employee_id") =>
  uuid(name)
    .notNull()
    .references(() => employees.id);

/** Per-company Earned Wage Access rules. Off until a person turns it on. */
export const ewaSettings = pgTable(
  "ewa_settings",
  {
    id: id(),
    organizationId: orgRef(),
    enabled: boolean("enabled").notNull().default(false),
    maxPercent: integer("max_percent").notNull().default(50),
    monthlyCap: bigint("monthly_cap", { mode: "number" }).notNull().default(2_000_000),
    autoApproveLimit: bigint("auto_approve_limit", { mode: "number" }).notNull().default(500_000),
    maxRequestsPerMonth: integer("max_requests_per_month").notNull().default(3),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ewa_settings_org_uq").on(t.organizationId),
    check("ewa_settings_pct", sql`${t.maxPercent} between 1 and 100`),
    check("ewa_settings_amounts", sql`${t.monthlyCap} > 0 and ${t.autoApproveLimit} >= 0`),
  ],
);

/**
 * An advance against earned salary. Approved requests become a one-instalment loan, so the amount is
 * recovered by the normal payroll run. No money moves: this is a mock payout, shown as such.
 */
export const ewaRequests = pgTable(
  "ewa_requests",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    month: text("month").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    earnedAtRequest: bigint("earned_at_request", { mode: "number" }).notNull(),
    status: text("status").notNull().default("pending"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    loanId: uuid("loan_id").references(() => loans.id),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [
    index("ewa_requests_emp_idx").on(t.organizationId, t.employeeId, t.month),
    index("ewa_requests_status_idx").on(t.organizationId, t.status),
    check("ewa_requests_amount", sql`${t.amount} > 0`),
    check("ewa_requests_status", sql`${t.status} in ('pending','approved','rejected','cancelled')`),
  ],
);

export const RECOGNITION_VALUES = [
  "teamwork",
  "ownership",
  "customer_focus",
  "innovation",
  "going_extra_mile",
] as const;

/** Peer recognition: a short public thank-you from one colleague to another. */
export const recognitions = pgTable(
  "recognitions",
  {
    id: id(),
    organizationId: orgRef(),
    fromEmployeeId: empRef("from_employee_id"),
    toEmployeeId: empRef("to_employee_id"),
    value: text("value").notNull(),
    message: text("message").notNull(),
    ...timestamps,
  },
  (t) => [
    index("recognitions_to_idx").on(t.organizationId, t.toEmployeeId, t.createdAt),
    index("recognitions_from_idx").on(t.organizationId, t.fromEmployeeId, t.createdAt),
    check("recognitions_not_self", sql`${t.fromEmployeeId} <> ${t.toEmployeeId}`),
    check("recognitions_message", sql`char_length(${t.message}) between 3 and 280`),
  ],
);

export interface SurveyQuestion {
  id: string;
  text: string;
  kind: "scale" | "text";
}

export const surveys = pgTable(
  "surveys",
  {
    id: id(),
    organizationId: orgRef(),
    title: text("title").notNull(),
    description: text("description"),
    questions: jsonb("questions").$type<SurveyQuestion[]>().notNull(),
    /** When on, each answer carries the respondent's department; results show only departments with enough answers. */
    byDepartment: boolean("by_department").notNull().default(false),
    status: text("status").notNull().default("open"),
    closesOn: date("closes_on"),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("surveys_org_idx").on(t.organizationId, t.status),
    check("surveys_status", sql`${t.status} in ('open','closed')`),
  ],
);

/** Who has answered, kept apart from the answers so a response cannot be traced to a person. */
export const surveyParticipation = pgTable(
  "survey_participation",
  {
    id: id(),
    organizationId: orgRef(),
    surveyId: uuid("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("survey_participation_uq").on(t.surveyId, t.userId)],
);

/** Anonymous by construction: no user, no employee, only the date (not the time) of submission. */
export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: id(),
    organizationId: orgRef(),
    surveyId: uuid("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    answers: jsonb("answers").$type<Record<string, number | string>>().notNull(),
    /** positive | neutral | negative, from the free-text answers. */
    sentiment: text("sentiment").notNull().default("neutral"),
    sentimentScore: integer("sentiment_score").notNull().default(0),
    submittedOn: date("submitted_on").notNull(),
  },
  (t) => [
    index("survey_responses_idx").on(t.organizationId, t.surveyId),
    check("survey_responses_sentiment", sql`${t.sentiment} in ('positive','neutral','negative')`),
  ],
);

/** Per-company feature switches. Unknown keys are ignored by the app. */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: id(),
    organizationId: orgRef(),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedBy: text("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("feature_flags_org_key_uq").on(t.organizationId, t.key)],
);

/** Indicative display rates set by the company (units of the currency per 1 INR). Payroll stays in INR. */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: id(),
    organizationId: orgRef(),
    currency: text("currency").notNull(),
    perInr: numeric("per_inr", { precision: 18, scale: 8 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("fx_rates_org_cur_uq").on(t.organizationId, t.currency),
    check("fx_rates_positive", sql`${t.perInr} > 0`),
  ],
);

/** DPDP / GDPR requests: a person asks for their data, or asks to be erased. */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: id(),
    organizationId: orgRef(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [
    index("privacy_requests_idx").on(t.organizationId, t.status, t.createdAt),
    check("privacy_requests_kind", sql`${t.kind} in ('export','erasure')`),
    check(
      "privacy_requests_status",
      sql`${t.status} in ('pending','completed','rejected','cancelled')`,
    ),
  ],
);

/** Market pay ranges the company enters itself (from a survey it bought, for example). None are bundled. */
export const salaryBenchmarks = pgTable(
  "salary_benchmarks",
  {
    id: id(),
    organizationId: orgRef(),
    designationId: uuid("designation_id")
      .notNull()
      .references(() => designations.id, { onDelete: "cascade" }),
    p25: bigint("p25", { mode: "number" }).notNull(),
    p50: bigint("p50", { mode: "number" }).notNull(),
    p75: bigint("p75", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    asOf: date("as_of").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("salary_benchmarks_org_desig_uq").on(t.organizationId, t.designationId),
    check(
      "salary_benchmarks_order",
      sql`${t.p25} > 0 and ${t.p25} <= ${t.p50} and ${t.p50} <= ${t.p75}`,
    ),
  ],
);
