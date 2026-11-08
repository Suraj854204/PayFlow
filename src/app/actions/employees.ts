"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import Papa from "papaparse";
import { z } from "zod";
import { requireActionPermission } from "@/lib/auth/context";
import { runAction } from "@/lib/action-runner";
import { emitEvent } from "@/lib/workflow/dispatch";
import { UserFacingError } from "@/lib/action";
import { blindIndex, decrypt, encrypt } from "@/lib/crypto";
import {
  checklistItems,
  departments,
  designations,
  employeeDocuments,
  employees,
  invitations,
} from "@/lib/db/schema";
import {
  DEFAULT_OFFBOARDING,
  DEFAULT_ONBOARDING,
  employeeSchema,
  uuid,
  type EmployeeInput,
} from "@/lib/validation/hr";
import type { Tx } from "@/lib/db";

const PATHS = ["/employees", "/org-chart"];
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOC_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function sensitiveColumns(data: EmployeeInput) {
  return {
    panEnc: data.pan ? encrypt(data.pan) : null,
    panIndex: data.pan ? blindIndex(data.pan) : null,
    aadhaarEnc: data.aadhaar ? encrypt(data.aadhaar) : null,
    bankAccountEnc: data.bankAccount ? encrypt(data.bankAccount) : null,
  };
}

function plainColumns(data: EmployeeInput) {
  return {
    employeeCode: data.employeeCode,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: data.phone ?? null,
    gender: data.gender ?? null,
    dateOfBirth: data.dateOfBirth ?? null,
    joinDate: data.joinDate,
    probationEndDate: data.probationEndDate ?? null,
    employmentType: data.employmentType,
    departmentId: data.departmentId ?? null,
    designationId: data.designationId ?? null,
    managerId: data.managerId ?? null,
    workState: data.workState ?? null,
    taxRegime: data.taxRegime,
    bankIfsc: data.bankIfsc ?? null,
    bankName: data.bankName ?? null,
    uan: data.uan ?? null,
    esiNumber: data.esiNumber ?? null,
  };
}

/** A manager chain must never loop back to the employee (it would break the org chart). */
async function assertNoCycle(
  tx: Tx,
  orgId: string,
  employeeId: string,
  managerId: string | undefined,
) {
  if (!managerId) return;
  if (managerId === employeeId)
    throw new UserFacingError("An employee cannot report to themselves.");
  let cursor: string | null = managerId;
  for (let i = 0; i < 50 && cursor; i++) {
    const [row]: { managerId: string | null }[] = await tx
      .select({ managerId: employees.managerId })
      .from(employees)
      .where(and(eq(employees.id, cursor), eq(employees.organizationId, orgId)));
    if (!row) return;
    if (row.managerId === employeeId)
      throw new UserFacingError("That reporting line would create a loop.");
    cursor = row.managerId;
  }
}

async function seedChecklist(
  tx: Tx,
  orgId: string,
  employeeId: string,
  kind: "onboarding" | "offboarding",
) {
  const titles = kind === "onboarding" ? DEFAULT_ONBOARDING : DEFAULT_OFFBOARDING;
  await tx.insert(checklistItems).values(
    titles.map((title, position) => ({
      organizationId: orgId,
      employeeId,
      kind,
      title,
      position,
    })),
  );
}

function isUniqueViolation(err: unknown): string | null {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.cause?.code;
  if (code !== "23505") return null;
  return e.constraint ?? e.cause?.constraint ?? "unique";
}

function friendlyUnique(constraint: string): string {
  if (constraint.includes("code")) return "That employee code is already in use.";
  if (constraint.includes("email")) return "An employee with that email already exists.";
  if (constraint.includes("pan")) return "Another employee already has that PAN.";
  return "That record already exists.";
}

export async function createEmployeeAction(input: unknown) {
  let event: { orgId: string; payload: Record<string, unknown> } | null = null;
  const res = await runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const data = employeeSchema.parse(input);
      await assertNoCycle(tx, ctx.organizationId, "new", data.managerId);
      try {
        await tx.execute(sql`savepoint create_emp`);
        const [row] = await tx
          .insert(employees)
          .values({
            organizationId: ctx.organizationId,
            ...plainColumns(data),
            ...sensitiveColumns(data),
            status: data.probationEndDate ? "probation" : "active",
            probationEndDate: data.probationEndDate ?? addMonths(data.joinDate, 6),
          })
          .returning({ id: employees.id });
        await seedChecklist(tx, ctx.organizationId, row.id, "onboarding");
        await audit({
          action: "employee.created",
          entityType: "employee",
          entityId: row.id,
          newValues: {
            employeeCode: data.employeeCode,
            name: `${data.firstName} ${data.lastName}`.trim(),
            email: data.email,
          },
        });
        const [dept] = data.departmentId
          ? await tx
              .select({ n: departments.name })
              .from(departments)
              .where(eq(departments.id, data.departmentId))
          : [];
        const [desig] = data.designationId
          ? await tx
              .select({ n: designations.title })
              .from(designations)
              .where(eq(designations.id, data.designationId))
          : [];
        event = {
          orgId: ctx.organizationId,
          payload: {
            employee: {
              id: row.id,
              name: `${data.firstName} ${data.lastName}`.trim(),
              email: data.email,
              department: dept?.n ?? "",
              designation: desig?.n ?? "",
              joinDate: data.joinDate,
            },
          },
        };
        return { id: row.id };
      } catch (err) {
        const c = isUniqueViolation(err);
        if (c) {
          await tx.execute(sql`rollback to savepoint create_emp`);
          throw new UserFacingError(friendlyUnique(c));
        }
        throw err;
      }
    },
    PATHS,
  );
  const e = event as { orgId: string; payload: Record<string, unknown> } | null;
  if (res.ok && e) await emitEvent(e.orgId, "employee.joined", e.payload).catch(console.error);
  return res;
}

export async function updateEmployeeAction(id: unknown, input: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const employeeId = uuid.parse(id);
      const data = employeeSchema.parse(input);
      await assertNoCycle(tx, ctx.organizationId, employeeId, data.managerId);

      const [before] = await tx
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.organizationId, ctx.organizationId),
            isNull(employees.deletedAt),
          ),
        );
      if (!before) throw new UserFacingError("Employee not found.");

      // Blank sensitive inputs mean "leave unchanged" so editing a profile never wipes them.
      const sens = sensitiveColumns(data);
      const patch = {
        ...plainColumns(data),
        ...(data.pan ? { panEnc: sens.panEnc, panIndex: sens.panIndex } : {}),
        ...(data.aadhaar ? { aadhaarEnc: sens.aadhaarEnc } : {}),
        ...(data.bankAccount ? { bankAccountEnc: sens.bankAccountEnc } : {}),
      };
      await tx.execute(sql`savepoint upd_emp`);
      try {
        await tx.update(employees).set(patch).where(eq(employees.id, employeeId));
      } catch (err) {
        const c = isUniqueViolation(err);
        if (c) {
          await tx.execute(sql`rollback to savepoint upd_emp`);
          throw new UserFacingError(friendlyUnique(c));
        }
        throw err;
      }

      const changed: Record<string, { from: unknown; to: unknown }> = {};
      const plain = plainColumns(data);
      for (const [k, v] of Object.entries(plain)) {
        const old = (before as Record<string, unknown>)[k] ?? null;
        if (old !== v) changed[k] = { from: old, to: v };
      }
      if (data.pan) changed.pan = { from: "(hidden)", to: "(updated)" };
      if (data.aadhaar) changed.aadhaar = { from: "(hidden)", to: "(updated)" };
      if (data.bankAccount) changed.bankAccount = { from: "(hidden)", to: "(updated)" };
      await audit({
        action: "employee.updated",
        entityType: "employee",
        entityId: employeeId,
        oldValues: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
        newValues: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
      });
    },
    [...PATHS, `/employees/${String(id)}`],
  );
}

const exitSchema = z.object({
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2, "Give a short reason").max(300),
});

/** Moves an employee to notice/exited and creates the offboarding checklist (once). */
export async function startOffboardingAction(id: unknown, input: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const employeeId = uuid.parse(id);
      const data = exitSchema.parse(input);
      const [before] = await tx
        .select({ status: employees.status, joinDate: employees.joinDate })
        .from(employees)
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.organizationId, ctx.organizationId),
            isNull(employees.deletedAt),
          ),
        );
      if (!before) throw new UserFacingError("Employee not found.");
      if (before.status === "exited")
        throw new UserFacingError("This employee has already exited.");
      if (data.exitDate < before.joinDate)
        throw new UserFacingError("Exit date cannot be before the join date.");

      const today = new Date().toISOString().slice(0, 10);
      const status = data.exitDate <= today ? "exited" : "notice";
      await tx
        .update(employees)
        .set({ status, exitDate: data.exitDate, exitReason: data.reason })
        .where(eq(employees.id, employeeId));

      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(checklistItems)
        .where(
          and(eq(checklistItems.employeeId, employeeId), eq(checklistItems.kind, "offboarding")),
        );
      if (n === 0) await seedChecklist(tx, ctx.organizationId, employeeId, "offboarding");

      await audit({
        action: "employee.offboarding_started",
        entityType: "employee",
        entityId: employeeId,
        oldValues: { status: before.status },
        newValues: { status, exitDate: data.exitDate, reason: data.reason },
      });
    },
    [...PATHS, `/employees/${String(id)}`],
  );
}

export async function deleteEmployeeAction(id: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const employeeId = uuid.parse(id);
      const [row] = await tx
        .update(employees)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.organizationId, ctx.organizationId),
            isNull(employees.deletedAt),
          ),
        )
        .returning({ code: employees.employeeCode, email: employees.email });
      if (!row) throw new UserFacingError("Employee not found.");
      // Reports of this person lose their manager rather than pointing at a deleted record.
      await tx
        .update(employees)
        .set({ managerId: null })
        .where(eq(employees.managerId, employeeId));
      await audit({
        action: "employee.deleted",
        entityType: "employee",
        entityId: employeeId,
        oldValues: row,
      });
    },
    PATHS,
  );
}

/** Reveals decrypted PAN/Aadhaar/bank account. Every reveal is audited. */
export async function revealSensitiveAction(id: unknown) {
  return runAction("employees:write", async ({ ctx, tx, audit }) => {
    const employeeId = uuid.parse(id);
    const [row] = await tx
      .select({
        pan: employees.panEnc,
        aadhaar: employees.aadhaarEnc,
        bank: employees.bankAccountEnc,
      })
      .from(employees)
      .where(
        and(
          eq(employees.id, employeeId),
          eq(employees.organizationId, ctx.organizationId),
          isNull(employees.deletedAt),
        ),
      );
    if (!row) throw new UserFacingError("Employee not found.");
    await audit({
      action: "employee.sensitive_revealed",
      entityType: "employee",
      entityId: employeeId,
    });
    return {
      pan: row.pan ? decrypt(row.pan) : null,
      aadhaar: row.aadhaar ? decrypt(row.aadhaar) : null,
      bankAccount: row.bank ? decrypt(row.bank) : null,
    };
  });
}

export async function toggleChecklistItemAction(itemId: unknown, done: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const id = uuid.parse(itemId);
      const isDone = z.boolean().parse(done);
      const [row] = await tx
        .update(checklistItems)
        .set({ doneAt: isDone ? new Date() : null, doneBy: isDone ? ctx.user.id : null })
        .where(
          and(eq(checklistItems.id, id), eq(checklistItems.organizationId, ctx.organizationId)),
        )
        .returning({
          employeeId: checklistItems.employeeId,
          title: checklistItems.title,
          kind: checklistItems.kind,
        });
      if (!row) throw new UserFacingError("Checklist item not found.");
      await audit({
        action: isDone ? "checklist.completed" : "checklist.reopened",
        entityType: "employee",
        entityId: row.employeeId,
        newValues: { title: row.title, kind: row.kind },
      });
    },
    ["/employees"],
  );
}

const docTypeSchema = z.enum(["pan", "aadhaar", "bank_proof", "offer_letter", "resume", "other"]);

export async function uploadDocumentAction(formData: FormData) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const employeeId = uuid.parse(formData.get("employeeId"));
      const type = docTypeSchema.parse(formData.get("type"));
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0)
        throw new UserFacingError("Choose a file to upload.");
      if (file.size > MAX_DOC_BYTES) throw new UserFacingError("Files can be at most 5 MB.");
      if (!ALLOWED_DOC_TYPES.has(file.type))
        throw new UserFacingError("Only PDF, PNG or JPG files are allowed.");

      const buf = Buffer.from(await file.arrayBuffer());
      // Verify magic bytes so a renamed file cannot pass as a PDF/image.
      const head = buf.subarray(0, 4).toString("hex");
      const okMagic =
        (file.type === "application/pdf" && head === "25504446") ||
        (file.type === "image/png" && head === "89504e47") ||
        (file.type === "image/jpeg" && head.startsWith("ffd8ff"));
      if (!okMagic) throw new UserFacingError("The file contents do not match its type.");

      const [emp] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.organizationId, ctx.organizationId),
            isNull(employees.deletedAt),
          ),
        );
      if (!emp) throw new UserFacingError("Employee not found.");

      const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
      const [doc] = await tx
        .insert(employeeDocuments)
        .values({
          organizationId: ctx.organizationId,
          employeeId,
          type,
          fileName: safeName,
          mimeType: file.type,
          sizeBytes: file.size,
          data: buf,
          uploadedBy: ctx.user.id,
        })
        .returning({ id: employeeDocuments.id });
      await audit({
        action: "employee.document_uploaded",
        entityType: "employee",
        entityId: employeeId,
        newValues: { type, fileName: safeName, sizeBytes: file.size },
      });
      return { id: doc.id };
    },
    [`/employees/${String(formData.get("employeeId"))}`],
  );
}

export async function deleteDocumentAction(docId: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const id = uuid.parse(docId);
      const [row] = await tx
        .update(employeeDocuments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(employeeDocuments.id, id),
            eq(employeeDocuments.organizationId, ctx.organizationId),
            isNull(employeeDocuments.deletedAt),
          ),
        )
        .returning({
          employeeId: employeeDocuments.employeeId,
          fileName: employeeDocuments.fileName,
          type: employeeDocuments.type,
        });
      if (!row) throw new UserFacingError("Document not found.");
      await audit({
        action: "employee.document_deleted",
        entityType: "employee",
        entityId: row.employeeId,
        oldValues: row,
      });
    },
    ["/employees"],
  );
}

// ---------- CSV import ----------

const CSV_HEADERS = [
  "employee_code",
  "first_name",
  "last_name",
  "email",
  "phone",
  "gender",
  "date_of_birth",
  "join_date",
  "employment_type",
  "department",
  "designation",
  "work_state",
  "pan",
  "bank_account",
  "bank_ifsc",
  "bank_name",
] as const;

export async function csvTemplateAction() {
  await requireActionPermission("employees:write");
  return (
    CSV_HEADERS.join(",") +
    "\nE100,Asha,Verma,asha@example.com,9876543210,female,1994-05-12,2026-04-01,full_time,Engineering,Software Engineer,Karnataka,,,,\n"
  );
}

export interface CsvRowError {
  row: number;
  message: string;
}

/**
 * Imports employees from CSV. All-or-nothing: if any row is invalid nothing is written, and every
 * problem is returned so the user can fix the file in one pass.
 */
export async function importEmployeesCsvAction(csv: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const text = z.string().max(2_000_000).parse(csv);
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      if (parsed.data.length === 0) throw new UserFacingError("The file has no rows.");
      if (parsed.data.length > 1000)
        throw new UserFacingError("Import at most 1000 rows at a time.");
      const missing = ["employee_code", "first_name", "email", "join_date"].filter(
        (h) => !parsed.meta.fields?.includes(h),
      );
      if (missing.length)
        throw new UserFacingError(`Missing required column(s): ${missing.join(", ")}`);

      const depts = await tx.query.departments.findMany({
        where: (d, { and: a, eq: e, isNull: n }) =>
          a(e(d.organizationId, ctx.organizationId), n(d.deletedAt)),
      });
      const desigs = await tx.query.designations.findMany({
        where: (d, { and: a, eq: e, isNull: n }) =>
          a(e(d.organizationId, ctx.organizationId), n(d.deletedAt)),
      });
      const deptByName = new Map(depts.map((d) => [d.name.toLowerCase(), d.id]));
      const desigByTitle = new Map(desigs.map((d) => [d.title.toLowerCase(), d.id]));

      const existing = await tx
        .select({ code: employees.employeeCode, email: employees.email })
        .from(employees)
        .where(and(eq(employees.organizationId, ctx.organizationId), isNull(employees.deletedAt)));
      const usedCodes = new Set(existing.map((e) => e.code));
      const usedEmails = new Set(existing.map((e) => e.email));

      const errors: CsvRowError[] = [];
      const valid: EmployeeInput[] = [];
      parsed.data.forEach((raw, i) => {
        const rowNo = i + 2; // header is row 1
        const get = (k: string) => (raw[k] ?? "").trim();
        const dept = get("department");
        const desig = get("designation");
        if (dept && !deptByName.has(dept.toLowerCase()))
          return void errors.push({ row: rowNo, message: `Unknown department "${dept}"` });
        if (desig && !desigByTitle.has(desig.toLowerCase()))
          return void errors.push({ row: rowNo, message: `Unknown designation "${desig}"` });
        const r = employeeSchema.safeParse({
          employeeCode: get("employee_code"),
          firstName: get("first_name"),
          lastName: get("last_name"),
          email: get("email"),
          phone: get("phone"),
          gender: get("gender").toLowerCase() || undefined,
          dateOfBirth: get("date_of_birth"),
          joinDate: get("join_date"),
          employmentType: get("employment_type").toLowerCase() || undefined,
          departmentId: dept ? deptByName.get(dept.toLowerCase()) : undefined,
          designationId: desig ? desigByTitle.get(desig.toLowerCase()) : undefined,
          workState: get("work_state"),
          pan: get("pan"),
          bankAccount: get("bank_account"),
          bankIfsc: get("bank_ifsc"),
          bankName: get("bank_name"),
        });
        if (!r.success) {
          const first = r.error.issues[0];
          return void errors.push({
            row: rowNo,
            message: `${first.path.join(".") || "row"}: ${first.message}`,
          });
        }
        if (usedCodes.has(r.data.employeeCode))
          return void errors.push({
            row: rowNo,
            message: `Employee code ${r.data.employeeCode} already exists or is repeated`,
          });
        if (usedEmails.has(r.data.email))
          return void errors.push({
            row: rowNo,
            message: `Email ${r.data.email} already exists or is repeated`,
          });
        usedCodes.add(r.data.employeeCode);
        usedEmails.add(r.data.email);
        valid.push(r.data);
      });

      if (errors.length > 0) return { imported: 0, errors: errors.slice(0, 100) };

      const inserted = await tx
        .insert(employees)
        .values(
          valid.map((d) => ({
            organizationId: ctx.organizationId,
            ...plainColumns(d),
            ...sensitiveColumns(d),
            status: "probation" as const,
            probationEndDate: addMonths(d.joinDate, 6),
          })),
        )
        .returning({ id: employees.id });
      await tx.insert(checklistItems).values(
        inserted.flatMap((e) =>
          DEFAULT_ONBOARDING.map((title, position) => ({
            organizationId: ctx.organizationId,
            employeeId: e.id,
            kind: "onboarding" as const,
            title,
            position,
          })),
        ),
      );
      await audit({
        action: "employee.imported",
        entityType: "employee",
        newValues: { count: inserted.length },
      });
      return { imported: inserted.length, errors: [] as CsvRowError[] };
    },
    PATHS,
  );
}

// ---------- Invitations (let an employee log in) ----------

const inviteSchema = z.object({
  employeeId: z.string().uuid(),
  role: z.enum(["hr_admin", "finance", "manager", "employee"]),
});

/** Creates a single-use invite link (valid 7 days). Only the hash of the token is stored. */
export async function inviteEmployeeAction(input: unknown) {
  return runAction("members:manage", async ({ ctx, tx, audit }) => {
    const data = inviteSchema.parse(input);
    const [emp] = await tx
      .select({ email: employees.email })
      .from(employees)
      .where(
        and(
          eq(employees.id, data.employeeId),
          eq(employees.organizationId, ctx.organizationId),
          isNull(employees.deletedAt),
        ),
      );
    if (!emp) throw new UserFacingError("Employee not found.");

    const token = randomBytes(32).toString("base64url");
    await tx.insert(invitations).values({
      organizationId: ctx.organizationId,
      email: emp.email,
      role: data.role,
      employeeId: data.employeeId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      invitedBy: ctx.user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    await audit({
      action: "member.invited",
      entityType: "employee",
      entityId: data.employeeId,
      newValues: { email: emp.email, role: data.role },
    });
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    return { link: `${base}/invite/${token}` };
  });
}
