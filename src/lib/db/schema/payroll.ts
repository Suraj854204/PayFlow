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
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { users } from "./auth";
import { employees } from "./hr";
import { organizations } from "./tenancy";

const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const payrollStatusEnum = pgEnum("payroll_status", [
  "draft",
  "review",
  "approved",
  "processing",
  "paid",
  "cancelled",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "queued",
  "processing",
  "processed",
  "failed",
  "reversed",
]);
export const loanStatusEnum = pgEnum("loan_status", ["active", "closed", "cancelled"]);

export interface PayLineJson {
  code: string;
  name: string;
  amount: number;
}
export interface PayWarningJson {
  severity: "error" | "warning" | "info";
  message: string;
}

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: id(),
    organizationId: orgRef(),
    /** YYYY-MM */
    month: text("month").notNull(),
    status: payrollStatusEnum("status").notNull().default("draft"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    submittedBy: text("submitted_by").references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    processedBy: text("processed_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    employeeCount: integer("employee_count").notNull().default(0),
    totalGross: money("total_gross"),
    totalDeductions: money("total_deductions"),
    totalNet: money("total_net"),
    totalEmployerCost: money("total_employer_cost"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("payroll_runs_org_idx").on(t.organizationId, t.month),
    // A month can only run once; a cancelled run frees the month.
    uniqueIndex("payroll_runs_org_month_uq")
      .on(t.organizationId, t.month)
      .where(sql`${t.status} <> 'cancelled'`),
    // Maker-checker: the approver can never be the person who prepared or submitted the run.
    check(
      "payroll_runs_maker_checker",
      sql`${t.approvedBy} is null or (${t.approvedBy} <> ${t.createdBy} and ${t.approvedBy} is distinct from ${t.submittedBy})`,
    ),
    check("payroll_runs_month_fmt", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: id(),
    organizationId: orgRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    // Inputs (editable while the run is a draft)
    lopDays: numeric("lop_days", { precision: 4, scale: 1 }).notNull().default("0"),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    arrears: money("arrears"),
    bonus: money("bonus"),
    reimbursement: money("reimbursement"),
    /** Approved expense claims included in this item (added to reimbursement). */
    expenseAmount: money("expense_amount"),
    otherDeduction: money("other_deduction"),
    loanEmi: money("loan_emi"),
    onHold: boolean("on_hold").notNull().default(false),
    holdReason: text("hold_reason"),
    // Computed snapshot
    earnings: jsonb("earnings").$type<PayLineJson[]>().notNull().default([]),
    deductions: jsonb("deductions").$type<PayLineJson[]>().notNull().default([]),
    employer: jsonb("employer").$type<PayLineJson[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<PayWarningJson[]>().notNull().default([]),
    gross: money("gross"),
    totalDeductions: money("total_deductions"),
    net: money("net"),
    employerCost: money("employer_cost"),
    taxableEarnings: money("taxable_earnings"),
    /** Wages PF / ESI were computed on, for statutory returns. */
    pfWages: money("pf_wages"),
    esiWages: money("esi_wages"),
    paidDays: numeric("paid_days", { precision: 4, scale: 1 }).notNull().default("0"),
    // Frozen at calculation so a re-run never silently uses newer data.
    ctcAnnual: money("ctc_annual"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payroll_items_run_emp_uq").on(t.runId, t.employeeId),
    index("payroll_items_org_emp_idx").on(t.organizationId, t.employeeId),
    check(
      "payroll_items_inputs_nonneg",
      sql`${t.arrears} >= 0 and ${t.bonus} >= 0 and ${t.reimbursement} >= 0 and ${t.otherDeduction} >= 0 and ${t.loanEmi} >= 0 and ${t.overtimeMinutes} >= 0`,
    ),
  ],
);

export const payslips = pgTable(
  "payslips",
  {
    id: id(),
    organizationId: orgRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => payrollItems.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    number: text("number").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payslips_run_emp_uq").on(t.runId, t.employeeId),
    uniqueIndex("payslips_org_number_uq").on(t.organizationId, t.number),
    index("payslips_emp_idx").on(t.organizationId, t.employeeId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: orgRef(),
    runId: uuid("run_id").references(() => payrollRuns.id, { onDelete: "cascade" }),
    settlementId: uuid("settlement_id"),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: paymentStatusEnum("status").notNull().default("queued"),
    provider: text("provider").notNull().default("simulated"),
    providerRef: text("provider_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    /** Masked destination, e.g. "HDFC0001234 ••••6789". The full number is never stored here. */
    destination: text("destination"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payments_org_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("payments_run_idx").on(t.runId),
    index("payments_ref_idx").on(t.providerRef),
    check("payments_amount_positive", sql`${t.amount} > 0`),
  ],
);

/** Deduplicates provider webhooks. Holds no tenant data, so it is not tenant-scoped. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_uq").on(t.provider, t.eventId)],
);

export const loans = pgTable(
  "loans",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    kind: text("kind").notNull().default("loan"),
    principal: bigint("principal", { mode: "number" }).notNull(),
    emi: bigint("emi", { mode: "number" }).notNull(),
    balance: bigint("balance", { mode: "number" }).notNull(),
    startMonth: text("start_month").notNull(),
    status: loanStatusEnum("status").notNull().default("active"),
    reason: text("reason"),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("loans_org_emp_idx").on(t.organizationId, t.employeeId),
    check(
      "loans_amounts",
      sql`${t.principal} > 0 and ${t.emi} > 0 and ${t.balance} >= 0 and ${t.balance} <= ${t.principal}`,
    ),
  ],
);

export const loanRepayments = pgTable(
  "loan_repayments",
  {
    id: id(),
    organizationId: orgRef(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => payrollRuns.id),
    month: text("month").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("loan_repayments_uq").on(t.loanId, t.month)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    lastWorkingDay: date("last_working_day").notNull(),
    inputs: jsonb("inputs").$type<Record<string, number>>().notNull(),
    lines: jsonb("lines").$type<{ label: string; amount: number }[]>().notNull(),
    payable: bigint("payable", { mode: "number" }).notNull(),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("settlements_org_emp_uq").on(t.organizationId, t.employeeId),
    check(
      "settlements_maker_checker",
      sql`${t.approvedBy} is null or ${t.approvedBy} is distinct from ${t.createdBy}`,
    ),
  ],
);
