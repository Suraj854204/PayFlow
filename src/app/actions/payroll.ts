"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { dispatchRunPayments } from "@/lib/payments/dispatch";
import { can, canApproveAsChecker } from "@/lib/rbac";
import type { Tx } from "@/lib/db";
import {
  employees,
  expenseClaims,
  loanRepayments,
  loans,
  payments,
  payrollItems,
  payrollRuns,
  payslips,
} from "@/lib/db/schema";
import { MONTH_RE } from "@/lib/payroll/period";
import {
  calcItem,
  gatherExtras,
  loadYtd,
  loanEmiFor,
  pfOverride,
  salaryAt,
} from "@/lib/payroll/service";
import type { PayInputs } from "@/lib/payroll/engine";
import { emitEvent } from "@/lib/workflow/dispatch";
import { createRunTx, lockRun, refreshTotals, submitRunTx } from "@/lib/payroll/run-core";
import { uuid } from "@/lib/validation/hr";

const PATHS = ["/payroll", "/dashboard", "/payslips"];

const createSchema = z.object({ month: z.string().regex(MONTH_RE, "Pick a month") });

export async function createRunAction(input: unknown) {
  return runAction("payroll:create", (h) => createRunTx(h, createSchema.parse(input).month), PATHS);
}

const itemSchema = z.object({
  itemId: uuid,
  lopDays: z.number().min(0).max(31).multipleOf(0.5).default(0),
  overtimeMinutes: z.number().int().min(0).max(100_000).default(0),
  arrears: z.number().int().min(0).max(10_000_000_000).default(0),
  bonus: z.number().int().min(0).max(10_000_000_000).default(0),
  reimbursement: z.number().int().min(0).max(10_000_000_000).default(0),
  otherDeduction: z.number().int().min(0).max(10_000_000_000).default(0),
  onHold: z.boolean().default(false),
  holdReason: z.string().trim().max(200).optional(),
});

async function recomputeItem(
  tx: Tx,
  orgId: string,
  runMonth: string,
  itemId: string,
  patch?: Partial<PayInputs> & { onHold?: boolean; holdReason?: string | null },
) {
  const [item] = await tx
    .select()
    .from(payrollItems)
    .where(and(eq(payrollItems.id, itemId), eq(payrollItems.organizationId, orgId)));
  if (!item) throw new UserFacingError("Payroll item not found.");
  const [emp] = await tx.select().from(employees).where(eq(employees.id, item.employeeId));
  const salary = await salaryAt(tx, orgId, item.employeeId, runMonth);
  if (!salary) throw new UserFacingError("This employee has no salary effective for the month.");
  const ytd = (await loadYtd(tx, orgId, runMonth, [item.employeeId])).get(item.employeeId) ?? {
    taxable: 0,
    tds: 0,
    pf: 0,
    pt: 0,
  };
  const ex = await gatherExtras(tx, orgId, emp, salary, runMonth);
  // A plain recalculation re-reads locked attendance; an explicit edit by HR overrides it.
  const fromAttendance = !patch && ex.attendance;
  const inputs: PayInputs = {
    lopDays: patch?.lopDays ?? (fromAttendance ? ex.attendance!.lopDays : Number(item.lopDays)),
    overtimeMinutes:
      patch?.overtimeMinutes ??
      (fromAttendance ? ex.attendance!.overtimeMinutes : item.overtimeMinutes),
    arrears: patch?.arrears ?? item.arrears,
    bonus: patch?.bonus ?? item.bonus,
    reimbursement: patch?.reimbursement ?? item.reimbursement,
    otherDeduction: patch?.otherDeduction ?? item.otherDeduction,
    loanEmi: await loanEmiFor(tx, orgId, item.employeeId, runMonth),
  };
  const values = calcItem(emp, salary, runMonth, inputs, ytd, await pfOverride(tx, orgId), {
    expenseAmount: ex.expenseAmount,
    declarations: ex.declarations,
  });
  await tx
    .update(payrollItems)
    .set({
      ...values,
      ...(patch?.onHold !== undefined
        ? { onHold: patch.onHold, holdReason: patch.onHold ? (patch.holdReason ?? null) : null }
        : {}),
    })
    .where(eq(payrollItems.id, itemId));
  return { before: item, after: values };
}

export async function updateItemAction(input: unknown) {
  return runAction(
    "payroll:create",
    async ({ ctx, tx, audit }) => {
      const data = itemSchema.parse(input);
      const [item] = await tx
        .select({ runId: payrollItems.runId })
        .from(payrollItems)
        .where(eq(payrollItems.id, data.itemId));
      if (!item) throw new UserFacingError("Payroll item not found.");
      const run = await lockRun(tx, ctx.organizationId, item.runId);
      if (run.status !== "draft")
        throw new UserFacingError("Only a draft run can be edited. Return it to draft first.");
      if (data.onHold && !data.holdReason)
        throw new UserFacingError("Give a reason for holding this payment.");
      const { before, after } = await recomputeItem(
        tx,
        ctx.organizationId,
        run.month,
        data.itemId,
        data,
      );
      await refreshTotals(tx, run.id);
      await audit({
        action: "payroll_item.updated",
        entityType: "payroll_item",
        entityId: data.itemId,
        oldValues: {
          lopDays: before.lopDays,
          overtimeMinutes: before.overtimeMinutes,
          arrears: before.arrears,
          bonus: before.bonus,
          reimbursement: before.reimbursement,
          otherDeduction: before.otherDeduction,
          onHold: before.onHold,
          net: before.net,
        },
        newValues: { ...data, net: after.net },
      });
      return { net: after.net ?? 0 };
    },
    PATHS,
  );
}

/** Re-reads salaries, loans and YTD tax for every item of a draft run, keeping the manual inputs. */
export async function recalculateRunAction(input: unknown) {
  return runAction(
    "payroll:create",
    async ({ ctx, tx, audit }) => {
      const { runId } = z.object({ runId: uuid }).parse(input);
      const run = await lockRun(tx, ctx.organizationId, runId);
      if (run.status !== "draft")
        throw new UserFacingError("Only a draft run can be recalculated.");
      const items = await tx
        .select({ id: payrollItems.id })
        .from(payrollItems)
        .where(eq(payrollItems.runId, runId));
      for (const i of items) await recomputeItem(tx, ctx.organizationId, run.month, i.id);
      await refreshTotals(tx, runId);
      await audit({
        action: "payroll_run.recalculated",
        entityType: "payroll_run",
        entityId: runId,
        metadata: { items: items.length },
      });
      return { items: items.length };
    },
    PATHS,
  );
}

const runIdSchema = z.object({ runId: uuid });

export async function submitRunAction(input: unknown) {
  return runAction("payroll:create", (h) => submitRunTx(h, runIdSchema.parse(input).runId), PATHS);
}

export async function approveRunAction(input: unknown) {
  let event: { orgId: string; payload: Record<string, unknown> } | null = null;
  const res = await runAction(
    "payroll:approve",
    async ({ ctx, tx, audit }) => {
      const { runId } = runIdSchema.parse(input);
      const run = await lockRun(tx, ctx.organizationId, runId);
      if (run.status !== "review")
        throw new UserFacingError("Only a run in review can be approved.");
      if (!canApproveAsChecker(run.createdBy, ctx.user.id) || run.submittedBy === ctx.user.id)
        throw new UserFacingError(
          "Maker-checker: you cannot approve a payroll run you prepared or submitted.",
        );
      await tx
        .update(payrollRuns)
        .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: new Date() })
        .where(eq(payrollRuns.id, runId));
      await audit({
        action: "payroll_run.approved",
        entityType: "payroll_run",
        entityId: runId,
        oldValues: { status: "review" },
        newValues: { status: "approved", totalNet: run.totalNet },
      });
      event = {
        orgId: ctx.organizationId,
        payload: {
          run: {
            id: runId,
            month: run.month,
            monthLabel: run.month,
            employees: run.employeeCount,
            totalNet: run.totalNet,
            totalNetInr: `₹${(Number(run.totalNet) / 100).toLocaleString("en-IN")}`,
          },
        },
      };
      return {};
    },
    PATHS,
  );
  const e = event as { orgId: string; payload: Record<string, unknown> } | null;
  if (res.ok && e) await emitEvent(e.orgId, "payroll.approved", e.payload).catch(console.error);
  return res;
}

export async function returnRunAction(input: unknown) {
  return runAction(
    "payroll:read",
    async ({ ctx, tx, audit }) => {
      const { runId } = runIdSchema.parse(input);
      if (!can(ctx.role, "payroll:approve") && !can(ctx.role, "payroll:create"))
        throw new UserFacingError("You do not have permission to do that.");
      const run = await lockRun(tx, ctx.organizationId, runId);
      if (run.status !== "review" && run.status !== "approved")
        throw new UserFacingError("Only a run in review or approved can be returned to draft.");
      await tx
        .update(payrollRuns)
        .set({
          status: "draft",
          submittedBy: null,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
        })
        .where(eq(payrollRuns.id, runId));
      await audit({
        action: "payroll_run.returned",
        entityType: "payroll_run",
        entityId: runId,
        oldValues: { status: run.status },
        newValues: { status: "draft" },
      });
      return {};
    },
    PATHS,
  );
}

export async function cancelRunAction(input: unknown) {
  return runAction(
    "payroll:read",
    async ({ ctx, tx, audit }) => {
      const { runId } = runIdSchema.parse(input);
      const run = await lockRun(tx, ctx.organizationId, runId);
      const allowed =
        run.status === "draft"
          ? can(ctx.role, "payroll:create")
          : (run.status === "review" || run.status === "approved") &&
            can(ctx.role, "payroll:approve");
      if (!allowed)
        throw new UserFacingError("This run cannot be cancelled by you in its current state.");
      await tx.update(payrollRuns).set({ status: "cancelled" }).where(eq(payrollRuns.id, runId));
      await audit({
        action: "payroll_run.cancelled",
        entityType: "payroll_run",
        entityId: runId,
        oldValues: { status: run.status },
        newValues: { status: "cancelled" },
      });
      return {};
    },
    PATHS,
  );
}

/**
 * Process an approved run. The run row is locked, so a double click or two admins cannot process it
 * twice: the second caller sees status "processing" and is turned away. Payslips, payments and loan
 * repayments are created in the same transaction; money is only sent after it commits.
 */
export async function processRunAction(input: unknown) {
  const res = await runAction(
    "payroll:process",
    async ({ ctx, tx, audit }) => {
      const { runId } = runIdSchema.parse(input);
      const run = await lockRun(tx, ctx.organizationId, runId);
      if (run.status !== "approved")
        throw new UserFacingError(
          run.status === "processing" || run.status === "paid"
            ? "This run has already been processed."
            : "Only an approved run can be processed.",
        );
      const items = await tx
        .select()
        .from(payrollItems)
        .where(and(eq(payrollItems.runId, runId), eq(payrollItems.onHold, false)));
      const emps = await tx
        .select({ id: employees.id, code: employees.employeeCode })
        .from(employees);
      const codeOf = new Map(emps.map((e) => [e.id, e.code]));

      await tx
        .update(payrollRuns)
        .set({ status: "processing", processedBy: ctx.user.id, processedAt: new Date() })
        .where(eq(payrollRuns.id, runId));

      await tx
        .insert(payslips)
        .values(
          items.map((i) => ({
            organizationId: ctx.organizationId,
            runId,
            employeeId: i.employeeId,
            itemId: i.id,
            month: run.month,
            number: `PS-${run.month.replace("-", "")}-${codeOf.get(i.employeeId) ?? i.employeeId.slice(0, 6)}`,
          })),
        )
        .onConflictDoNothing();

      const payable = items.filter((i) => (i.net ?? 0) > 0);
      if (payable.length)
        await tx
          .insert(payments)
          .values(
            payable.map((i) => ({
              organizationId: ctx.organizationId,
              runId,
              employeeId: i.employeeId,
              amount: i.net,
              idempotencyKey: `${runId}:${i.employeeId}`,
            })),
          )
          .onConflictDoNothing();

      // Expense claims included in this run become paid, and are tied to it. Claims are matched in
      // approval order; if they no longer add up to what was calculated, stop rather than guess.
      for (const i of items.filter((x) => x.expenseAmount > 0)) {
        const claims = await tx
          .select()
          .from(expenseClaims)
          .where(
            and(
              eq(expenseClaims.employeeId, i.employeeId),
              eq(expenseClaims.status, "approved"),
              isNull(expenseClaims.runId),
            ),
          )
          .orderBy(asc(expenseClaims.decidedAt), asc(expenseClaims.createdAt));
        let remaining = i.expenseAmount;
        for (const c of claims) {
          if (c.amount > remaining) break;
          await tx
            .update(expenseClaims)
            .set({ status: "paid", runId })
            .where(eq(expenseClaims.id, c.id));
          remaining -= c.amount;
          if (remaining === 0) break;
        }
        if (remaining !== 0)
          throw new UserFacingError(
            "Expense claims changed since this run was calculated. Return it to draft and recalculate.",
          );
      }

      // Loan repayments: split each item's EMI over the employee's active loans, oldest first.
      for (const i of items.filter((x) => x.loanEmi > 0)) {
        let remaining = i.loanEmi;
        const active = await tx
          .select()
          .from(loans)
          .where(
            and(
              eq(loans.organizationId, ctx.organizationId),
              eq(loans.employeeId, i.employeeId),
              eq(loans.status, "active"),
            ),
          )
          .orderBy(asc(loans.createdAt));
        for (const l of active) {
          if (remaining <= 0) break;
          const pay = Math.min(l.emi, l.balance, remaining);
          if (pay <= 0) continue;
          await tx
            .insert(loanRepayments)
            .values({
              organizationId: ctx.organizationId,
              loanId: l.id,
              runId,
              month: run.month,
              amount: pay,
            })
            .onConflictDoNothing();
          await tx
            .update(loans)
            .set({ balance: l.balance - pay, status: l.balance - pay === 0 ? "closed" : "active" })
            .where(eq(loans.id, l.id));
          remaining -= pay;
        }
      }

      await audit({
        action: "payroll_run.processed",
        entityType: "payroll_run",
        entityId: runId,
        oldValues: { status: "approved" },
        newValues: { status: "processing", payments: payable.length, totalNet: run.totalNet },
      });
      return { runId, payments: payable.length };
    },
    PATHS,
  );
  if (!res.ok) return res;
  const actor = await actorFromContext();
  const sent = await dispatchRunPayments(actor, res.data.runId);
  const { revalidatePath } = await import("next/cache");
  for (const p of PATHS) revalidatePath(p);
  return { ok: true as const, data: { ...res.data, ...sent } };
}

export async function retryPaymentsAction(input: unknown) {
  const res = await runAction(
    "payroll:process",
    async ({ ctx, tx }) => {
      const { runId } = runIdSchema.parse(input);
      const run = await lockRun(tx, ctx.organizationId, runId);
      if (run.status !== "processing")
        throw new UserFacingError("Payments can only be retried while a run is processing.");
      return { runId };
    },
    PATHS,
  );
  if (!res.ok) return res;
  const actor = await actorFromContext();
  const sent = await dispatchRunPayments(actor, res.data.runId);
  const { revalidatePath } = await import("next/cache");
  for (const p of PATHS) revalidatePath(p);
  return { ok: true as const, data: sent };
}

async function actorFromContext() {
  const { requireActionPermission } = await import("@/lib/auth/context");
  const ctx = await requireActionPermission("payroll:process");
  return { organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role };
}
