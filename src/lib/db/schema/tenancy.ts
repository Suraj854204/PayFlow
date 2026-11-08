import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
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

export const roleEnum = pgEnum("role", [
  "super_admin",
  "hr_admin",
  "finance",
  "manager",
  "employee",
]);
export const paycycleEnum = pgEnum("pay_cycle", ["monthly"]);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    legalName: text("legal_name"),
    logoUrl: text("logo_url"),
    /** White-label name shown in the app shell and emails instead of "PayFlow". */
    brandName: text("brand_name"),
    defaultLocale: text("default_locale").notNull().default("en"),
    /** Email domains that must sign in with Google or Microsoft (empty = password allowed). */
    ssoDomains: text("sso_domains")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    brandColor: text("brand_color").notNull().default("#6366f1"),
    currency: text("currency").notNull().default("INR"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    country: text("country").notNull().default("IN"),
    state: text("state"),
    addressLine: text("address_line"),
    payCycle: paycycleEnum("pay_cycle").notNull().default("monthly"),
    /** Day of month payroll is paid (1-28). */
    payDay: integer("pay_day").notNull().default(1),
    /** Attendance cut-off day for payroll month. */
    cutoffDay: integer("cutoff_day").notNull().default(25),
    // Statutory registrations
    pan: text("pan"),
    tan: text("tan"),
    gstin: text("gstin"),
    pfEstablishmentCode: text("pf_establishment_code"),
    /** Optional override of the EPFO wage ceiling, in paise. */
    pfWageCeiling: bigint("pf_wage_ceiling", { mode: "number" }),
    esiCode: text("esi_code"),
    /** Office location for attendance geo-fencing. All three must be set to enforce it. */
    geofenceLat: doublePrecision("geofence_lat"),
    geofenceLng: doublePrecision("geofence_lng"),
    geofenceRadiusM: integer("geofence_radius_m"),
    /** Weekly off days, 0 = Sunday ... 6 = Saturday. */
    weeklyOffs: integer("weekly_offs")
      .array()
      .notNull()
      .default(sql`'{0}'::integer[]`),
    ptRegistrationNo: text("pt_registration_no"),
    featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().notNull().default({}),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

/** Membership: a user can belong to many companies with a different role in each. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("employee"),
    /** Link to employees row once HR creates one. Filled in Phase 2. */
    employeeId: uuid("employee_id"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
    index("memberships_org_idx").on(t.organizationId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("employee"),
    tokenHash: text("token_hash").notNull(),
    /** Employee record this invitation links to when accepted (optional). */
    employeeId: uuid("employee_id"),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("invitations_org_idx").on(t.organizationId),
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    parentId: uuid("parent_id"),
    headEmployeeId: uuid("head_employee_id"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("departments_org_idx").on(t.organizationId),
    uniqueIndex("departments_org_name_uq")
      .on(t.organizationId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const designations = pgTable(
  "designations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    level: integer("level").notNull().default(1),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("designations_org_idx").on(t.organizationId),
    uniqueIndex("designations_org_title_uq")
      .on(t.organizationId, t.title)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    date: date("date").notNull(),
    isOptional: boolean("is_optional").notNull().default(false),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("holidays_org_date_idx").on(t.organizationId, t.date),
    uniqueIndex("holidays_org_date_name_uq").on(t.organizationId, t.date, t.name),
  ],
);

/**
 * Immutable, hash-chained audit log. Each row stores the hash of the previous row for the same
 * organization, so any tampering breaks the chain. A DB trigger (see migrations/rls.sql) blocks
 * UPDATE and DELETE.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    actorUserId: text("actor_user_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_logs_org_seq_uq").on(t.organizationId, t.seq),
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.organizationId, t.entityType, t.entityId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("notifications_user_idx").on(t.organizationId, t.userId, t.readAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    responseBody: jsonb("response_body"),
    statusCode: integer("status_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_org_scope_key_uq").on(t.organizationId, t.scope, t.key)],
);
