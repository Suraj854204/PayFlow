import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { users } from "./auth";
import { employees } from "./hr";
import { payrollRuns } from "./payroll";
import { organizations } from "./tenancy";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const empRef = () =>
  uuid("employee_id")
    .notNull()
    .references(() => employees.id);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "half_day",
  "absent",
  "leave",
  "holiday",
  "weekly_off",
]);
export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const expenseStatusEnum = pgEnum("expense_status", [
  "submitted",
  "approved",
  "rejected",
  "paid",
]);
export const declarationStatusEnum = pgEnum("declaration_status", [
  "draft",
  "submitted",
  "verified",
  "rejected",
]);

export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** Minutes after the start time that still count as on time. */
    graceMinutes: integer("grace_minutes").notNull().default(10),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("shifts_org_idx").on(t.organizationId),
    uniqueIndex("shifts_org_name_uq")
      .on(t.organizationId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const roster = pgTable(
  "roster",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    date: date("date").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("roster_emp_date_uq").on(t.employeeId, t.date),
    index("roster_org_date_idx").on(t.organizationId, t.date),
  ],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    date: date("date").notNull(),
    status: attendanceStatusEnum("status").notNull().default("present"),
    checkIn: timestamp("check_in", { withTimezone: true }),
    checkOut: timestamp("check_out", { withTimezone: true }),
    inLat: doublePrecision("in_lat"),
    inLng: doublePrecision("in_lng"),
    outLat: doublePrecision("out_lat"),
    outLng: doublePrecision("out_lng"),
    /** null = no geo-fence configured or no location sent. */
    inGeofence: boolean("in_geofence"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    /** self (check-in), manual (HR), system (month close), leave */
    source: text("source").notNull().default("self"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("attendance_emp_date_uq").on(t.employeeId, t.date),
    index("attendance_org_date_idx").on(t.organizationId, t.date),
    check(
      "attendance_times",
      sql`${t.checkOut} is null or ${t.checkIn} is null or ${t.checkOut} >= ${t.checkIn}`,
    ),
  ],
);

/** Months whose attendance is locked for payroll. Records in a locked month cannot change. */
export const attendanceLocks = pgTable(
  "attendance_locks",
  {
    id: id(),
    organizationId: orgRef(),
    month: text("month").notNull(),
    lockedBy: text("locked_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("attendance_locks_uq").on(t.organizationId, t.month)],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: id(),
    organizationId: orgRef(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Days granted per financial year. */
    annualQuota: numeric("annual_quota", { precision: 5, scale: 1 }).notNull().default("0"),
    /** false = unpaid: approved days become loss of pay in payroll. */
    isPaid: boolean("is_paid").notNull().default(true),
    carryForwardMax: numeric("carry_forward_max", { precision: 5, scale: 1 })
      .notNull()
      .default("0"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("leave_types_org_code_uq")
      .on(t.organizationId, t.code)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    /** Starting year of the financial year, e.g. 2026 for FY 2026-27. */
    fyStart: integer("fy_start").notNull(),
    allotted: numeric("allotted", { precision: 5, scale: 1 }).notNull().default("0"),
    used: numeric("used", { precision: 5, scale: 1 }).notNull().default("0"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leave_balances_uq").on(t.employeeId, t.leaveTypeId, t.fyStart),
    check(
      "leave_balances_nonneg",
      sql`${t.allotted} >= 0 and ${t.used} >= 0 and ${t.used} <= ${t.allotted}`,
    ),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    /** Working days charged (0.5 steps), excluding weekly offs and holidays. */
    days: numeric("days", { precision: 5, scale: 1 }).notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    reason: text("reason"),
    status: requestStatusEnum("status").notNull().default("pending"),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [
    index("leave_requests_org_status_idx").on(t.organizationId, t.status),
    index("leave_requests_emp_idx").on(t.employeeId, t.fromDate),
    check("leave_requests_range", sql`${t.toDate} >= ${t.fromDate} and ${t.days} > 0`),
  ],
);

export const expenseClaims = pgTable(
  "expense_claims",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    category: text("category").notNull(),
    description: text("description"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    expenseDate: date("expense_date").notNull(),
    receiptName: text("receipt_name"),
    receiptMime: text("receipt_mime"),
    receiptData: bytea("receipt_data"),
    status: expenseStatusEnum("status").notNull().default("submitted"),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Set when the claim is paid through a payroll run. */
    runId: uuid("run_id").references(() => payrollRuns.id),
    ...timestamps,
  },
  (t) => [
    index("expense_claims_org_status_idx").on(t.organizationId, t.status),
    index("expense_claims_emp_idx").on(t.employeeId),
    check("expense_claims_amount", sql`${t.amount} > 0`),
  ],
);

export interface DeclarationData {
  section80C: number;
  section80D: number;
  /** Annual rent paid, paise. */
  annualRent: number;
  metro: boolean;
  landlordName?: string;
  landlordPan?: string;
  otherDeductions: number;
}

export const taxDeclarations = pgTable(
  "tax_declarations",
  {
    id: id(),
    organizationId: orgRef(),
    employeeId: empRef(),
    fyStart: integer("fy_start").notNull(),
    regime: text("regime").notNull().default("new"),
    data: jsonb("data").$type<DeclarationData>().notNull(),
    status: declarationStatusEnum("status").notNull().default("draft"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewNote: text("review_note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_declarations_uq").on(t.employeeId, t.fyStart)],
);

export const complianceItems = pgTable(
  "compliance_items",
  {
    id: id(),
    organizationId: orgRef(),
    /** PF, ESI, PT, TDS, TDS_RETURN */
    kind: text("kind").notNull(),
    /** YYYY-MM the obligation relates to; for TDS_RETURN the quarter's last month. */
    period: text("period").notNull(),
    dueDate: date("due_date").notNull(),
    status: text("status").notNull().default("pending"),
    challanNo: text("challan_no"),
    amountPaid: bigint("amount_paid", { mode: "number" }),
    paidOn: date("paid_on"),
    notes: text("notes"),
    lastRemindedOn: date("last_reminded_on"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("compliance_items_uq").on(t.organizationId, t.kind, t.period),
    index("compliance_items_due_idx").on(t.organizationId, t.dueDate),
    check("compliance_items_status", sql`${t.status} in ('pending','filed')`),
  ],
);

/** Company announcements shown on every dashboard. Pinned ones stay on top; expired ones vanish. */
export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    organizationId: orgRef(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    expiresOn: date("expires_on"),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("announcements_org_idx").on(t.organizationId, t.createdAt),
    check("announcements_title_len", sql`char_length(${t.title}) between 1 and 120`),
    check("announcements_body_len", sql`char_length(${t.body}) between 1 and 2000`),
  ],
);
