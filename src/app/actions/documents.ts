"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { blindIndex, decrypt, encrypt, maskValue } from "@/lib/crypto";
import { documentExtractions, employees } from "@/lib/db/schema";
import { DOC_KINDS, validateFields, type DocKind, type Fields } from "@/lib/docai/fields";

const PATHS = ["/documents"];
const verifySchema = z.object({
  id: z.string().uuid(),
  fields: z.record(z.string(), z.string().max(300)),
});

export interface ExtractionView {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: DocKind;
  filename: string;
  status: string;
  engine: string;
  note: string | null;
  fields: Fields;
  createdAt: string;
}

/** Decrypts one pending extraction for the reviewer. Only HR roles with employee-write can see these. */
export async function loadExtractionsAction() {
  return runAction("employees:write", async ({ ctx, tx }) => {
    const rows = await tx
      .select({ d: documentExtractions, e: employees })
      .from(documentExtractions)
      .innerJoin(employees, eq(employees.id, documentExtractions.employeeId))
      .where(eq(documentExtractions.organizationId, ctx.organizationId))
      .orderBy(documentExtractions.createdAt);
    return rows
      .reverse()
      .slice(0, 30)
      .map(({ d, e }): ExtractionView => ({
        id: d.id,
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName ?? ""}`.trim(),
        kind: d.kind as DocKind,
        filename: d.filename,
        status: d.status,
        engine: d.engine,
        note: d.note,
        // Once decided, the values are not shown again.
        fields: d.status === "review" ? (JSON.parse(decrypt(d.fieldsEnc)) as Fields) : {},
        createdAt: d.createdAt.toISOString(),
      }));
  });
}

/**
 * The human verification step: the reviewer's (possibly corrected) values are validated and then
 * applied to the employee record. Nothing is applied by the AI on its own.
 */
export async function verifyExtractionAction(input: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const d = verifySchema.parse(input);
      const [row] = await tx
        .select()
        .from(documentExtractions)
        .where(
          and(
            eq(documentExtractions.id, d.id),
            eq(documentExtractions.organizationId, ctx.organizationId),
          ),
        )
        .for("update");
      if (!row) throw new UserFacingError("Document not found.");
      if (row.status !== "review") throw new UserFacingError("This document was already decided.");
      const kind = z.enum(DOC_KINDS).parse(row.kind);
      const { fields, issues } = validateFields(kind, d.fields);
      const first = Object.entries(issues)[0];
      if (first) throw new UserFacingError(`${first[0]}: ${first[1]}`);

      const [emp] = await tx
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.id, row.employeeId),
            eq(employees.organizationId, ctx.organizationId),
            isNull(employees.deletedAt),
          ),
        );
      if (!emp) throw new UserFacingError("Employee not found.");

      let applied: Record<string, string> = {};
      if (kind === "pan") {
        const dup = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(
            and(
              eq(employees.organizationId, ctx.organizationId),
              eq(employees.panIndex, blindIndex(fields.pan)),
              isNull(employees.deletedAt),
            ),
          );
        if (dup.some((x) => x.id !== emp.id))
          throw new UserFacingError("Another employee already has this PAN.");
        await tx
          .update(employees)
          .set({ panEnc: encrypt(fields.pan), panIndex: blindIndex(fields.pan) })
          .where(eq(employees.id, emp.id));
        applied = { PAN: maskValue(fields.pan) };
      } else if (kind === "aadhaar") {
        await tx
          .update(employees)
          .set({ aadhaarEnc: encrypt(fields.aadhaar) })
          .where(eq(employees.id, emp.id));
        applied = { Aadhaar: maskValue(fields.aadhaar) };
      } else if (kind === "bank_proof") {
        await tx
          .update(employees)
          .set({
            bankAccountEnc: encrypt(fields.accountNumber),
            bankIfsc: fields.ifsc,
            ...(fields.bankName ? { bankName: fields.bankName } : {}),
          })
          .where(eq(employees.id, emp.id));
        applied = { Account: maskValue(fields.accountNumber), IFSC: fields.ifsc };
      } else {
        applied = { Resume: "recorded" };
      }
      await tx
        .update(documentExtractions)
        .set({
          status: "verified",
          verifiedBy: ctx.user.id,
          verifiedAt: new Date(),
          fieldsEnc: encrypt(JSON.stringify(kind === "resume" ? fields : {})),
        })
        .where(eq(documentExtractions.id, row.id));
      await audit({
        action: "document.verified",
        entityType: "employee",
        entityId: emp.id,
        newValues: { kind, ...applied },
        metadata: { extractionId: row.id, engine: row.engine },
      });
      return null;
    },
    [...PATHS, "/employees"],
  );
}

export async function rejectExtractionAction(id: unknown) {
  return runAction(
    "employees:write",
    async ({ ctx, tx, audit }) => {
      const did = z.string().uuid().parse(id);
      const done = await tx
        .update(documentExtractions)
        .set({
          status: "rejected",
          verifiedBy: ctx.user.id,
          verifiedAt: new Date(),
          fieldsEnc: encrypt("{}"),
        })
        .where(
          and(
            eq(documentExtractions.id, did),
            eq(documentExtractions.organizationId, ctx.organizationId),
            eq(documentExtractions.status, "review"),
          ),
        )
        .returning({ id: documentExtractions.id, kind: documentExtractions.kind });
      if (done.length === 0) throw new UserFacingError("This document was already decided.");
      await audit({
        action: "document.rejected",
        entityType: "document_extraction",
        entityId: did,
        newValues: { kind: done[0].kind },
      });
      return null;
    },
    PATHS,
  );
}
