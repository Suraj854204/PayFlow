"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import {
  employeeDocuments,
  employees,
  expenseClaims,
  memberships,
  privacyRequests,
} from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { ERASED_NAME, erasedEmail } from "@/lib/privacy/erasure";

const uuid = z.string().uuid();

export async function requestErasureAction(input: unknown) {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(input);
  return runAction(
    "org:read",
    async ({ ctx, tx, audit }) => {
      const pending = await tx
        .select({ id: privacyRequests.id })
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.userId, ctx.user.id),
            eq(privacyRequests.kind, "erasure"),
            eq(privacyRequests.status, "pending"),
          ),
        );
      if (pending.length)
        throw new UserFacingError("You already have an erasure request waiting for review.");
      const [row] = await tx
        .insert(privacyRequests)
        .values({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          employeeId: ctx.employeeId,
          kind: "erasure",
          reason: reason || null,
        })
        .returning({ id: privacyRequests.id });
      await audit({
        action: "privacy.erasure_requested",
        entityType: "privacy_request",
        entityId: row.id,
      });
      return { id: row.id };
    },
    ["/privacy"],
  );
}

export async function cancelErasureAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  return runAction(
    "org:read",
    async ({ ctx, tx }) => {
      const r = await tx
        .update(privacyRequests)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(privacyRequests.id, id),
            eq(privacyRequests.userId, ctx.user.id),
            eq(privacyRequests.status, "pending"),
          ),
        )
        .returning({ id: privacyRequests.id });
      if (!r.length) throw new UserFacingError("Request not found or already decided.");
      return {};
    },
    ["/privacy"],
  );
}

const decideSchema = z.object({
  id: uuid,
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/**
 * HR decision on an erasure request. Approval removes the person's identifying details but keeps
 * payroll, tax and audit records, which the company must retain by law. A person who has not left
 * the company cannot be erased: payroll still needs to pay them.
 */
export async function decideErasureAction(input: unknown) {
  const d = decideSchema.parse(input);
  return runAction(
    "privacy:manage",
    async ({ ctx, tx, audit }) => {
      const [req] = await tx
        .select()
        .from(privacyRequests)
        .where(and(eq(privacyRequests.id, d.id), eq(privacyRequests.kind, "erasure")))
        .for("update");
      if (!req || req.status !== "pending")
        throw new UserFacingError("Request not found or already decided.");
      if (req.userId === ctx.user.id)
        throw new UserFacingError("You cannot decide your own request.");
      if (!d.approve && !d.note) throw new UserFacingError("Say why the request is declined.");

      if (d.approve) {
        if (!req.employeeId)
          throw new UserFacingError("This person has no employee record to erase.");
        const [e] = await tx
          .select({ status: employees.status })
          .from(employees)
          .where(eq(employees.id, req.employeeId));
        if (!e) throw new UserFacingError("Employee record not found.");
        if (e.status !== "exited")
          throw new UserFacingError(
            "Complete the employee's exit first. Payroll still needs their details until then.",
          );
        await tx
          .update(employees)
          .set({
            firstName: ERASED_NAME,
            lastName: "",
            email: erasedEmail(req.employeeId),
            phone: null,
            dateOfBirth: null,
            panEnc: null,
            panIndex: null,
            aadhaarEnc: null,
            bankAccountEnc: null,
            bankIfsc: null,
            bankName: null,
            uan: null,
            esiNumber: null,
            userId: null,
          })
          .where(eq(employees.id, req.employeeId));
        await tx.delete(employeeDocuments).where(eq(employeeDocuments.employeeId, req.employeeId));
        await tx
          .update(expenseClaims)
          .set({ receiptData: null, receiptName: null })
          .where(eq(expenseClaims.employeeId, req.employeeId));
        await tx
          .update(memberships)
          .set({ isActive: false })
          .where(
            and(
              eq(memberships.organizationId, ctx.organizationId),
              eq(memberships.userId, req.userId),
            ),
          );
      }
      await tx
        .update(privacyRequests)
        .set({
          status: d.approve ? "completed" : "rejected",
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: d.note || null,
        })
        .where(eq(privacyRequests.id, req.id));
      await audit({
        action: d.approve ? "privacy.erasure_completed" : "privacy.erasure_rejected",
        entityType: "privacy_request",
        entityId: req.id,
        newValues: { employeeId: req.employeeId, note: d.note ?? null },
      });
      if (!d.approve)
        await notify(tx, ctx.organizationId, {
          userId: req.userId,
          type: "privacy",
          title: "Your erasure request was declined",
          body: d.note,
          href: "/privacy",
        });
      return {};
    },
    ["/privacy"],
  );
}
