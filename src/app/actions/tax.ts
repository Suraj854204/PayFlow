"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { employees, taxDeclarations } from "@/lib/db/schema";
import { fyStartYear } from "@/lib/payroll/period";
import { notify } from "@/lib/notify";
import { PAN_RE, uuid } from "@/lib/validation/hr";

const PATHS = ["/tax", "/dashboard"];
const paise = z.number().int().min(0).max(100_000_000_00);

const saveSchema = z.object({
  regime: z.enum(["new", "old"]),
  section80C: paise.default(0),
  section80D: paise.default(0),
  annualRent: paise.default(0),
  metro: z.boolean().default(false),
  landlordName: z.string().trim().max(80).optional(),
  landlordPan: z.string().trim().toUpperCase().optional(),
  otherDeductions: paise.default(0),
  submit: z.boolean().default(false),
});

const currentFy = () =>
  fyStartYear(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7));

export async function saveDeclarationAction(input: unknown) {
  return runAction(
    "tax:read_own",
    async ({ ctx, tx, audit }) => {
      if (!ctx.employeeId)
        throw new UserFacingError(
          "Your login is not linked to an employee record in this company.",
        );
      const d = saveSchema.parse(input);
      if (d.annualRent > 1_00_000_00 && !(d.landlordPan && PAN_RE.test(d.landlordPan)))
        throw new UserFacingError("Rent above Rs 1,00,000 a year needs the landlord's PAN.");
      if (d.landlordPan && !PAN_RE.test(d.landlordPan))
        throw new UserFacingError("Landlord PAN looks like ABCDE1234F.");
      const fy = currentFy();
      const [old] = await tx
        .select()
        .from(taxDeclarations)
        .where(
          and(eq(taxDeclarations.employeeId, ctx.employeeId), eq(taxDeclarations.fyStart, fy)),
        );
      if (old?.status === "verified")
        throw new UserFacingError(
          "This declaration was verified by HR and can no longer be changed. Ask HR to reopen it.",
        );
      const data = {
        section80C: d.section80C,
        section80D: d.section80D,
        annualRent: d.annualRent,
        metro: d.metro,
        landlordName: d.landlordName,
        landlordPan: d.landlordPan,
        otherDeductions: d.otherDeductions,
      };
      const status = d.submit ? ("submitted" as const) : ("draft" as const);
      if (old)
        await tx
          .update(taxDeclarations)
          .set({ regime: d.regime, data, status, reviewedBy: null, reviewNote: null })
          .where(eq(taxDeclarations.id, old.id));
      else
        await tx.insert(taxDeclarations).values({
          organizationId: ctx.organizationId,
          employeeId: ctx.employeeId,
          fyStart: fy,
          regime: d.regime,
          data,
          status,
        });
      // The chosen regime drives TDS from the next payroll run.
      if (d.submit)
        await tx
          .update(employees)
          .set({ taxRegime: d.regime })
          .where(eq(employees.id, ctx.employeeId));
      await audit({
        action: d.submit ? "tax_declaration.submitted" : "tax_declaration.saved",
        entityType: "tax_declaration",
        entityId: ctx.employeeId,
        oldValues: old ? { regime: old.regime, ...old.data, status: old.status } : null,
        newValues: { regime: d.regime, ...data, status },
      });
      return { status };
    },
    PATHS,
  );
}

const reviewSchema = z.object({
  declarationId: uuid,
  verify: z.boolean(),
  note: z.string().trim().max(200).optional(),
});

export async function reviewDeclarationAction(input: unknown) {
  return runAction(
    "tax:manage",
    async ({ ctx, tx, audit }) => {
      const d = reviewSchema.parse(input);
      const [decl] = await tx
        .select()
        .from(taxDeclarations)
        .where(
          and(
            eq(taxDeclarations.id, d.declarationId),
            eq(taxDeclarations.organizationId, ctx.organizationId),
          ),
        );
      if (!decl) throw new UserFacingError("Declaration not found.");
      if (decl.status !== "submitted")
        throw new UserFacingError("Only a submitted declaration can be reviewed.");
      if (!d.verify && !d.note)
        throw new UserFacingError("Give a reason when rejecting a declaration.");
      await tx
        .update(taxDeclarations)
        .set({
          status: d.verify ? "verified" : "rejected",
          reviewedBy: ctx.user.id,
          reviewNote: d.note,
        })
        .where(eq(taxDeclarations.id, decl.id));
      const [emp] = await tx
        .select({ u: employees.userId })
        .from(employees)
        .where(eq(employees.id, decl.employeeId));
      await notify(tx, ctx.organizationId, {
        userId: emp?.u,
        type: "tax.reviewed",
        title: `Your tax declaration was ${d.verify ? "verified" : "rejected"}`,
        body: d.note,
        href: "/tax",
      });
      await audit({
        action: d.verify ? "tax_declaration.verified" : "tax_declaration.rejected",
        entityType: "tax_declaration",
        entityId: decl.id,
        oldValues: { status: "submitted" },
        newValues: { status: d.verify ? "verified" : "rejected", note: d.note },
      });
      return {};
    },
    PATHS,
  );
}
