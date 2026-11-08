import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { employees, payments, payrollRuns } from "@/lib/db/schema";
import { queueWebhookEvent } from "@/lib/workflow/outbox";
import { getProvider } from "./provider";

export interface Actor {
  organizationId: string;
  userId: string;
  role: string;
}

/**
 * Marks the run paid once every payment has settled. Runs inside the caller's transaction and locks
 * the run row, so two concurrent settlements cannot both finalize it.
 */
export async function settleRunIfComplete(
  tx: Tx,
  organizationId: string,
  runId: string,
): Promise<boolean> {
  await tx.execute(sql`select id from payroll_runs where id = ${runId} for update`);
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run || run.status !== "processing") return false;
  const open = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(eq(payments.runId, runId), inArray(payments.status, ["queued", "processing", "failed"])),
    )
    .limit(1);
  if (open.length) return false;
  await tx
    .update(payrollRuns)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(payrollRuns.id, runId));
  await writeAudit(tx, {
    organizationId,
    actorUserId: null,
    actorRole: "system",
    action: "payroll_run.paid",
    entityType: "payroll_run",
    entityId: runId,
    oldValues: { status: "processing" },
    newValues: { status: "paid" },
  });
  await queueWebhookEvent(tx, organizationId, "payroll.paid", {
    run: {
      id: runId,
      month: run.month,
      employees: run.employeeCount,
      totalNetPaise: Number(run.totalNet),
    },
  });
  return true;
}

/**
 * Sends every queued or failed payment of a run to the provider, one at a time. The provider call is
 * made OUTSIDE any database transaction (so a slow network never holds a connection or a lock), and
 * each payment's idempotency key makes a repeat call safe.
 */
export type DispatchScope = { runId: string } | { settlementId: string };

export async function dispatchRunPayments(
  actor: Actor,
  scope: string | DispatchScope,
): Promise<{ sent: number; failed: number }> {
  const sc: DispatchScope = typeof scope === "string" ? { runId: scope } : scope;
  const runId = "runId" in sc ? sc.runId : null;
  const provider = getProvider();
  const todo = await withTenant(actor.organizationId, (tx) =>
    tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          "runId" in sc ? eq(payments.runId, sc.runId) : eq(payments.settlementId, sc.settlementId),
          inArray(payments.status, ["queued", "failed"]),
        ),
      ),
  );
  let sent = 0;
  let failed = 0;
  for (const { id } of todo) {
    // 1. Claim the payment and read what we need to send.
    const job = await withTenant(actor.organizationId, async (tx) => {
      const claimed = await tx
        .update(payments)
        .set({ status: "processing", attempts: sql`${payments.attempts} + 1`, failureReason: null })
        .where(and(eq(payments.id, id), inArray(payments.status, ["queued", "failed"])))
        .returning();
      if (claimed.length === 0) return null; // someone else is handling it
      const p = claimed[0];
      const [e] = await tx.select().from(employees).where(eq(employees.id, p.employeeId));
      return { p, e };
    });
    if (!job) continue;
    const { p, e } = job;

    // 2. Call the provider (no transaction open).
    let outcome;
    if (!e?.bankAccountEnc || !e.bankIfsc) {
      outcome = {
        status: "failed" as const,
        reason: "Bank account or IFSC is missing for this employee",
      };
    } else {
      try {
        outcome = await provider.payout({
          idempotencyKey: p.idempotencyKey,
          amountPaise: p.amount,
          name: `${e.firstName} ${e.lastName}`.trim(),
          email: e.email,
          accountNumber: decrypt(e.bankAccountEnc),
          ifsc: e.bankIfsc,
          narration: "Salary",
        });
      } catch (err) {
        outcome = {
          status: "failed" as const,
          reason: err instanceof Error ? err.message : "Payout failed",
        };
      }
    }

    // 3. Record the result and audit it.
    await withTenant(actor.organizationId, async (tx) => {
      const patch =
        outcome.status === "failed"
          ? {
              status: "failed" as const,
              failureReason: outcome.reason.slice(0, 300),
              provider: provider.name,
            }
          : {
              status: outcome.status,
              providerRef: outcome.providerRef,
              provider: provider.name,
              processedAt: outcome.status === "processed" ? new Date() : null,
            };
      await tx.update(payments).set(patch).where(eq(payments.id, id));
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: outcome.status === "failed" ? "payment.failed" : "payment.sent",
        entityType: "payment",
        entityId: id,
        newValues: { status: patch.status, amount: p.amount, provider: provider.name },
        metadata:
          outcome.status === "failed"
            ? { reason: outcome.reason }
            : { providerRef: outcome.providerRef },
      });
      if (runId) await settleRunIfComplete(tx, actor.organizationId, runId);
    });
    if (outcome.status === "failed") failed++;
    else sent++;
  }
  return { sent, failed };
}
