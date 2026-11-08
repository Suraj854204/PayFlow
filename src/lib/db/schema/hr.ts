import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./_helpers";
import { users } from "./auth";
import { departments, designations, organizations } from "./tenancy";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const employeeStatusEnum = pgEnum("employee_status", [
  "active",
  "probation",
  "notice",
  "exited",
]);
export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "intern",
]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const componentTypeEnum = pgEnum("component_type", ["earning", "deduction"]);
export const calcTypeEnum = pgEnum("calc_type", [
  "fixed",
  "percent_of_ctc",
  "percent_of_basic",
  "balancing",
]);
export const checklistKindEnum = pgEnum("checklist_kind", ["onboarding", "offboarding"]);

export const employees = pgTable(
  "employees",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    employeeCode: text("employee_code").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    email: text("email").notNull(),
    phone: text("phone"),
    gender: genderEnum("gender"),
    dateOfBirth: date("date_of_birth"),
    joinDate: date("join_date").notNull(),
    probationEndDate: date("probation_end_date"),
    exitDate: date("exit_date"),
    exitReason: text("exit_reason"),
    status: employeeStatusEnum("status").notNull().default("active"),
    employmentType: employmentTypeEnum("employment_type").notNull().default("full_time"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    designationId: uuid("designation_id").references(() => designations.id, {
      onDelete: "set null",
    }),
    managerId: uuid("manager_id"),
    /** State used for Professional Tax. */
    workState: text("work_state"),
    /** Income tax regime used for TDS projection: "new" or "old". */
    taxRegime: text("tax_regime").notNull().default("new"),
    // Sensitive fields: AES-256-GCM ciphertext. Never select these into list views.
    panEnc: text("pan_enc"),
    panIndex: text("pan_index"),
    aadhaarEnc: text("aadhaar_enc"),
    bankAccountEnc: text("bank_account_enc"),
    bankIfsc: text("bank_ifsc"),
    bankName: text("bank_name"),
    uan: text("uan"),
    esiNumber: text("esi_number"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("employees_org_idx").on(t.organizationId),
    index("employees_org_status_idx").on(t.organizationId, t.status),
    index("employees_manager_idx").on(t.managerId),
    uniqueIndex("employees_org_code_uq")
      .on(t.organizationId, t.employeeCode)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("employees_org_email_uq")
      .on(t.organizationId, t.email)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("employees_org_pan_uq")
      .on(t.organizationId, t.panIndex)
      .where(sql`${t.deletedAt} is null and ${t.panIndex} is not null`),
  ],
);

/** Documents are stored in Postgres (max 5 MB each) so the app works on any host without extra keys. */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    uploadedBy: text("uploaded_by"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("employee_docs_emp_idx").on(t.organizationId, t.employeeId)],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: checklistKindEnum("kind").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: text("done_by"),
    ...timestamps,
  },
  (t) => [index("checklist_emp_idx").on(t.organizationId, t.employeeId, t.kind)],
);

export const salaryComponents = pgTable(
  "salary_components",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    type: componentTypeEnum("type").notNull().default("earning"),
    calcType: calcTypeEnum("calc_type").notNull().default("fixed"),
    /** fixed: monthly paise. percent_*: basis points (1% = 100). balancing: ignored. */
    value: bigint("value", { mode: "number" }).notNull().default(0),
    isTaxable: boolean("is_taxable").notNull().default(true),
    /** Counts toward the PF/ESI wage base (used by the Phase 3 payroll engine). */
    isPfWage: boolean("is_pf_wage").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("salary_components_org_idx").on(t.organizationId),
    uniqueIndex("salary_components_org_code_uq")
      .on(t.organizationId, t.code)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export interface StructureLine {
  componentId: string;
  code: string;
  name: string;
  type: "earning" | "deduction";
  calcType: "fixed" | "percent_of_ctc" | "percent_of_basic" | "balancing";
  value: number;
  isTaxable: boolean;
  isPfWage: boolean;
}

/** A reusable salary template: an ordered set of component lines. */
export const salaryStructures = pgTable(
  "salary_structures",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    lines: jsonb("lines").$type<StructureLine[]>().notNull().default([]),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("salary_structures_org_idx").on(t.organizationId),
    uniqueIndex("salary_structures_org_name_uq")
      .on(t.organizationId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export interface BreakdownLine {
  code: string;
  name: string;
  type: "earning" | "deduction";
  monthly: number;
  annual: number;
  isTaxable: boolean;
  isPfWage: boolean;
}

/** Append-only salary history. The row with the latest effective_from <= today is current. */
export const employeeSalaries = pgTable(
  "employee_salaries",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    structureId: uuid("structure_id").references(() => salaryStructures.id, {
      onDelete: "set null",
    }),
    /** Annual CTC in paise. */
    ctcAnnual: bigint("ctc_annual", { mode: "number" }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    breakdown: jsonb("breakdown").$type<BreakdownLine[]>().notNull(),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_salaries_emp_idx").on(t.organizationId, t.employeeId, t.effectiveFrom),
    uniqueIndex("employee_salaries_emp_eff_uq").on(t.employeeId, t.effectiveFrom),
  ],
);
