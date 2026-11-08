"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { departments, designations, holidays, organizations } from "@/lib/db/schema";
import { NATIONAL_HOLIDAYS, uuid } from "@/lib/validation/hr";

const PATHS = ["/setup", "/settings/organization"];

const nameList = z
  .array(z.string().trim().min(1).max(80))
  .min(1, "Add at least one")
  .max(100)
  .transform((a) => [...new Map(a.map((n) => [n.toLowerCase(), n])).values()]);

export async function saveDepartmentsAction(input: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const names = nameList.parse(input);
      const existing = await tx
        .select({ name: departments.name })
        .from(departments)
        .where(
          and(eq(departments.organizationId, ctx.organizationId), isNull(departments.deletedAt)),
        );
      const have = new Set(existing.map((e) => e.name.toLowerCase()));
      const fresh = names.filter((n) => !have.has(n.toLowerCase()));
      if (fresh.length > 0) {
        await tx
          .insert(departments)
          .values(fresh.map((name) => ({ organizationId: ctx.organizationId, name })));
        await audit({
          action: "department.created",
          entityType: "department",
          newValues: { names: fresh },
        });
      }
      return { added: fresh.length };
    },
    PATHS,
  );
}

export async function saveDesignationsAction(input: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const titles = nameList.parse(input);
      const existing = await tx
        .select({ title: designations.title })
        .from(designations)
        .where(
          and(eq(designations.organizationId, ctx.organizationId), isNull(designations.deletedAt)),
        );
      const have = new Set(existing.map((e) => e.title.toLowerCase()));
      const fresh = titles.filter((n) => !have.has(n.toLowerCase()));
      if (fresh.length > 0) {
        await tx
          .insert(designations)
          .values(fresh.map((title) => ({ organizationId: ctx.organizationId, title })));
        await audit({
          action: "designation.created",
          entityType: "designation",
          newValues: { titles: fresh },
        });
      }
      return { added: fresh.length };
    },
    PATHS,
  );
}

export async function removeDepartmentAction(id: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const deptId = uuid.parse(id);
      const [row] = await tx
        .update(departments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(departments.id, deptId),
            eq(departments.organizationId, ctx.organizationId),
            isNull(departments.deletedAt),
          ),
        )
        .returning({ name: departments.name });
      if (!row) throw new UserFacingError("Department not found.");
      await audit({
        action: "department.deleted",
        entityType: "department",
        entityId: deptId,
        oldValues: row,
      });
    },
    PATHS,
  );
}

const payScheduleSchema = z.object({
  payDay: z.coerce.number().int().min(1).max(28),
  cutoffDay: z.coerce.number().int().min(1).max(28),
});

export async function savePayScheduleAction(input: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const data = payScheduleSchema.parse(input);
      const [before] = await tx
        .select({ payDay: organizations.payDay, cutoffDay: organizations.cutoffDay })
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId));
      await tx.update(organizations).set(data).where(eq(organizations.id, ctx.organizationId));
      await audit({
        action: "organization.pay_schedule_updated",
        entityType: "organization",
        entityId: ctx.organizationId,
        oldValues: before,
        newValues: data,
      });
    },
    PATHS,
  );
}

const statutorySchema = z.object({
  state: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || null),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "PAN looks like ABCDE1234F"),
  tan: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(v), "TAN looks like ABCD12345E"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || null)
    .refine(
      (v) => v === null || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v),
      "Invalid GSTIN",
    ),
  pfEstablishmentCode: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
  esiCode: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
  ptRegistrationNo: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
});

export async function saveStatutoryAction(input: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const data = statutorySchema.parse(input);
      const [before] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId));
      await tx.update(organizations).set(data).where(eq(organizations.id, ctx.organizationId));
      await audit({
        action: "organization.statutory_updated",
        entityType: "organization",
        entityId: ctx.organizationId,
        oldValues: {
          state: before.state,
          pan: before.pan,
          tan: before.tan,
          gstin: before.gstin,
          pfEstablishmentCode: before.pfEstablishmentCode,
          esiCode: before.esiCode,
          ptRegistrationNo: before.ptRegistrationNo,
        },
        newValues: data,
      });
    },
    PATHS,
  );
}

const holidaySchema = z.object({
  name: z.string().trim().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isOptional: z.boolean().default(false),
});

export async function addHolidayAction(input: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const data = holidaySchema.parse(input);
      await tx
        .insert(holidays)
        .values({ organizationId: ctx.organizationId, ...data })
        .onConflictDoNothing();
      await audit({ action: "holiday.created", entityType: "holiday", newValues: data });
    },
    PATHS,
  );
}

export async function removeHolidayAction(id: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const hid = uuid.parse(id);
      const [row] = await tx
        .update(holidays)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(holidays.id, hid),
            eq(holidays.organizationId, ctx.organizationId),
            isNull(holidays.deletedAt),
          ),
        )
        .returning({ name: holidays.name, date: holidays.date });
      if (!row) throw new UserFacingError("Holiday not found.");
      await audit({
        action: "holiday.deleted",
        entityType: "holiday",
        entityId: hid,
        oldValues: row,
      });
    },
    PATHS,
  );
}

export async function addNationalHolidaysAction(year: unknown) {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      const y = z.coerce.number().int().min(2020).max(2100).parse(year);
      const rows = NATIONAL_HOLIDAYS.map((h) => ({
        organizationId: ctx.organizationId,
        name: h.name,
        date: `${y}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`,
      }));
      await tx.insert(holidays).values(rows).onConflictDoNothing();
      await audit({
        action: "holiday.national_added",
        entityType: "holiday",
        newValues: { year: y },
      });
    },
    PATHS,
  );
}

export async function completeOnboardingAction() {
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      await tx
        .update(organizations)
        .set({ onboardingCompletedAt: new Date() })
        .where(eq(organizations.id, ctx.organizationId));
      await audit({
        action: "organization.onboarding_completed",
        entityType: "organization",
        entityId: ctx.organizationId,
      });
    },
    ["/dashboard", "/setup"],
  );
}
