"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { ACTIONS, CONFIRM_WORD, type RaiseItem } from "@/lib/ai/actions";
import { writeAudit } from "@/lib/audit";
import { requireActionPermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { aiActions, employeeSalaries, type AiActionKind } from "@/lib/db/schema";
import { can, canAny } from "@/lib/rbac";
import { assignSalaryTx } from "@/lib/workforce/assign-salary";
import { decideLeaveAction } from "./leave";
import { cancelRunAction, createRunAction } from "./payroll";
import { desc } from "drizzle-orm";

const idSchema = z.object({
  id: z.string().uuid(),
  /** Destructive actions only: the user types the word. */
  confirmText: z.string().max(20).optional(),
});

/** Runs the real domain action. Each one re-checks the caller's permission and writes its own audit entry. */
async function execute(
  kind: AiActionKind,
  params: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  switch (kind) {
    case "approve_leave":
    case "reject_leave":
      return decideLeaveAction({
        requestId: params.requestId,
        approve: kind === "approve_leave",
        note: "Decided with PayBot",
      });
    case "create_payroll_draft":
      return createRunAction({ month: params.month });
    case "cancel_payroll_run":
      return cancelRunAction({ runId: params.runId });
    case "department_raise": {
      const items = params.items as RaiseItem[];
      const effectiveFrom = String(params.effectiveFrom);
      const percent = Number(params.percent);
      // One transaction: either every revision lands or none does.
      return runAction(
        "salary:write",
        async (h) => {
          for (const i of items) {
            const [cur] = await h.tx
              .select({ ctc: employeeSalaries.ctcAnnual })
              .from(employeeSalaries)
              .where(
                and(
                  eq(employeeSalaries.employeeId, i.employeeId),
                  eq(employeeSalaries.organizationId, h.ctx.organizationId),
                ),
              )
              .orderBy(desc(employeeSalaries.effectiveFrom))
              .limit(1);
            if (!cur || cur.ctc !== i.oldCtc)
              throw new UserFacingError(
                `${i.name}'s salary changed since this was proposed. Nothing was applied; ask again.`,
              );
            await assignSalaryTx(h, {
              employeeId: i.employeeId,
              structureId: i.structureId,
              ctcAnnual: i.newCtc,
              effectiveFrom,
              reason: `${percent}% department revision (PayBot)`,
            });
          }
          return { revised: items.length };
        },
        ["/salary", "/employees"],
      );
    }
  }
}

/**
 * Confirms a proposed action. The parameters come from the stored proposal, never from the client,
 * and the row is claimed atomically, so a double click or a second tab cannot run it twice.
 */
export async function confirmAiAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  try {
    const d = idSchema.parse(input);
    const ctx = await requireActionPermission("ai:use");
    const claimed = await withTenant(ctx.organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(aiActions)
        .where(
          and(
            eq(aiActions.id, d.id),
            eq(aiActions.organizationId, ctx.organizationId),
            eq(aiActions.userId, ctx.user.id),
          ),
        )
        .for("update");
      if (!row) throw new UserFacingError("That action was not found.");
      if (row.status !== "pending")
        throw new UserFacingError(`This action was already ${row.status}.`);
      if (row.expiresAt.getTime() < Date.now()) {
        await tx
          .update(aiActions)
          .set({ status: "expired", decidedAt: new Date() })
          .where(eq(aiActions.id, row.id));
        throw new UserFacingError("This proposal expired. Ask PayBot again.");
      }
      if (!can(ctx.role, "ai:act") || !canAny(ctx.role, ACTIONS[row.kind].anyOf))
        throw new UserFacingError("You do not have permission to do that.");
      if (row.destructive === 1 && d.confirmText?.trim() !== CONFIRM_WORD)
        throw new UserFacingError(`Type ${CONFIRM_WORD} to confirm this action.`);
      await tx
        .update(aiActions)
        .set({ status: "executing", decidedAt: new Date() })
        .where(eq(aiActions.id, row.id));
      return row;
    });

    const res = await execute(claimed.kind, claimed.params);
    const message = res.ok ? `${claimed.preview.title}: done.` : res.error;
    await withTenant(ctx.organizationId, async (tx) => {
      await tx
        .update(aiActions)
        .set({ status: res.ok ? "executed" : "failed", result: message })
        .where(eq(aiActions.id, claimed.id));
      await writeAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.user.id,
        actorRole: ctx.role,
        action: res.ok ? "ai.action.executed" : "ai.action.failed",
        entityType: "ai_action",
        entityId: claimed.id,
        newValues: { kind: claimed.kind, title: claimed.preview.title, result: message },
        metadata: { via: "paybot", destructive: claimed.destructive === 1 },
      });
    });
    for (const p of ["/leave", "/payroll", "/salary", "/employees", "/dashboard"])
      revalidatePath(p);
    return res.ok ? { ok: true, data: { message } } : { ok: false, error: message };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelAiAction(input: unknown) {
  return runAction("ai:use", async ({ ctx, tx, audit }) => {
    const { id } = idSchema.parse(input);
    const done = await tx
      .update(aiActions)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(
        and(
          eq(aiActions.id, id),
          eq(aiActions.organizationId, ctx.organizationId),
          eq(aiActions.userId, ctx.user.id),
          eq(aiActions.status, "pending"),
        ),
      )
      .returning({ id: aiActions.id, title: aiActions.preview });
    if (done.length === 0) throw new UserFacingError("That action can no longer be cancelled.");
    await audit({
      action: "ai.action.cancelled",
      entityType: "ai_action",
      entityId: id,
      newValues: { title: done[0].title.title },
    });
    return null;
  });
}
