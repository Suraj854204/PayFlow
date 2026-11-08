"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { dispatchRunPayments } from "@/lib/payments/dispatch";
import { employees, loanRepayments, loans, payments, settlements } from "@/lib/db/schema";
import {
  calcItem,
  gatherExtras,
  loadYtd,
  pfOverride,
  salaryAt,
  ZERO_INPUTS,
} from "@/lib/payroll/service";
import {
  computeGratuity,
  computeSettlement,
  leaveEncashment,
  tenureBetween,
} from "@/lib/payroll/settlement";
import { MONTH_RE } from "@/lib/payroll/period";
import { canApproveAsChecker } from "@/lib/rbac";
import { uuid } from "@/lib/validation/hr";

const loanSchema = z.object({
  employeeId: uuid,
  kind: z.enum(["loan", "advance"]).default("loan"),
  principal: z.number().int().min(100).max(100_000_000_00),
  emi: z.number().int().min(100),
  startMonth: z.string().regex(MONTH_RE),
  reason: z.string().trim().max(200).optional(),
});

export async function createLoanAction(input: unknown) {
  return runAction(
    "payroll:create",
    async ({ ctx, tx, audit }) => {
      const d = loanSchema.parse(input);
      if (d.emi > d.principal) throw new UserFacingError("The EMI cannot exceed the loan amount.");
      const [emp] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(eq(employees.id, d.employeeId), eq(employees.organizationId, ctx.organizationId)),
        );
      if (!emp) throw new UserFacingError("Employee not found.");
      const [row] = await tx
        .insert(loans)
        .values({
          organizationId: ctx.organizationId,
          ...d,
          balance: d.principal,
          createdBy: ctx.user.id,
        })
        .returning({ id: loans.id });
      await audit({ action: "loan.created", entityType: "loan", entityId: row.id, newValues: d });
      return { id: row.id };
    },
    [`/employees/${(input as { employeeId?: string })?.employeeId ?? ""}`],
  );
}

export async function cancelLoanAction(input: unknown) {
  return runAction(
    "payroll:create",
    async ({ ctx, tx, audit }) => {
      const { loanId } = z.object({ loanId: uuid }).parse(input);
      const [l] = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.id, loanId), eq(loans.organizationId, ctx.organizationId)));
      if (!l) throw new UserFacingError("Loan not found.");
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(loanRepayments)
        .where(eq(loanRepayments.loanId, loanId));
      if (n > 0)
        throw new UserFacingError(
          "This loan already has repayments. It will close once the balance reaches zero.",
        );
      await tx.update(loans).set({ status: "cancelled" }).where(eq(loans.id, loanId));
      await audit({
        action: "loan.cancelled",
        entityType: "loan",
        entityId: loanId,
        oldValues: { status: l.status },
      });
      return {};
    },
    ["/employees"],
  );
}

const settleSchema = z.object({
  employeeId: uuid,
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leaveDays: z.number().min(0).max(365).default(0),
  noticeRecovery: z.number().int().min(0).default(0),
  otherRecovery: z.number().int().min(0).default(0),
  deathOrDisability: z.boolean().default(false),
});

/** Prepares a full and final settlement. Figures come from the engine, not from the browser. */
export async function createSettlementAction(input: unknown) {
  return runAction(
    "payroll:create",
    async ({ ctx, tx, audit }) => {
      const d = settleSchema.parse(input);
      const [emp] = await tx
        .select()
        .from(employees)
        .where(
          and(eq(employees.id, d.employeeId), eq(employees.organizationId, ctx.organizationId)),
        );
      if (!emp) throw new UserFacingError("Employee not found.");
      if (d.lastWorkingDay < emp.joinDate)
        throw new UserFacingError("The last working day is before the joining date.");
      const month = d.lastWorkingDay.slice(0, 7);
      const salary = await salaryAt(tx, ctx.organizationId, emp.id, month);
      if (!salary) throw new UserFacingError("This employee has no salary on record.");

      const ytd = (await loadYtd(tx, ctx.organizationId, month, [emp.id])).get(emp.id) ?? {
        taxable: 0,
        tds: 0,
        pf: 0,
        pt: 0,
      };
      const item = calcItem(
        { ...emp, exitDate: d.lastWorkingDay },
        salary,
        month,
        { ...ZERO_INPUTS },
        ytd,
        await pfOverride(tx, ctx.organizationId),
        // Only the employee's verified tax declarations carry over; expenses and attendance are
        // settled through the monthly run, not the final settlement.
        {
          declarations: (await gatherExtras(tx, ctx.organizationId, emp, salary, month))
            .declarations,
        },
      );
      const basic = salary.breakdown.find((l) => l.code === "BASIC")?.monthly ?? 0;
      const g = computeGratuity(
        basic,
        tenureBetween(emp.joinDate, d.lastWorkingDay),
        d.deathOrDisability,
      );
      const outstanding = (
        await tx
          .select({ b: loans.balance })
          .from(loans)
          .where(and(eq(loans.employeeId, emp.id), eq(loans.status, "active")))
      ).reduce((s, l) => s + l.b, 0);
      const result = computeSettlement({
        finalSalaryNet: item.net ?? 0,
        leaveEncashment: leaveEncashment(basic, d.leaveDays),
        gratuity: g.amount,
        noticeRecovery: d.noticeRecovery,
        loanOutstanding: outstanding,
        otherRecovery: d.otherRecovery,
      });
      if (result.payable <= 0)
        throw new UserFacingError(
          "Recoveries exceed what is owed, so nothing is payable. Review the figures.",
        );

      const values = {
        organizationId: ctx.organizationId,
        employeeId: emp.id,
        lastWorkingDay: d.lastWorkingDay,
        inputs: {
          leaveDays: d.leaveDays,
          noticeRecovery: d.noticeRecovery,
          otherRecovery: d.otherRecovery,
          gratuityEligible: g.eligible ? 1 : 0,
        },
        lines: result.lines,
        payable: result.payable,
        createdBy: ctx.user.id,
        status: "draft",
      };
      const existing = await tx
        .select()
        .from(settlements)
        .where(and(eq(settlements.employeeId, emp.id)));
      if (existing[0] && existing[0].status !== "draft")
        throw new UserFacingError("A settlement for this employee is already approved or paid.");
      let id: string;
      if (existing[0]) {
        await tx.update(settlements).set(values).where(eq(settlements.id, existing[0].id));
        id = existing[0].id;
      } else {
        [{ id }] = await tx.insert(settlements).values(values).returning({ id: settlements.id });
      }
      await audit({
        action: "settlement.prepared",
        entityType: "settlement",
        entityId: id,
        newValues: { payable: result.payable, gratuityNote: g.note },
      });
      return { id, payable: result.payable, gratuityNote: g.note };
    },
    ["/employees", "/payroll"],
  );
}

export async function approveSettlementAction(input: unknown) {
  return runAction(
    "payroll:approve",
    async ({ ctx, tx, audit }) => {
      const { settlementId } = z.object({ settlementId: uuid }).parse(input);
      await tx.execute(sql`select id from settlements where id = ${settlementId} for update`);
      const [s] = await tx
        .select()
        .from(settlements)
        .where(
          and(eq(settlements.id, settlementId), eq(settlements.organizationId, ctx.organizationId)),
        );
      if (!s) throw new UserFacingError("Settlement not found.");
      if (s.status !== "draft")
        throw new UserFacingError("This settlement is not awaiting approval.");
      if (!s.createdBy || !canApproveAsChecker(s.createdBy, ctx.user.id))
        throw new UserFacingError("Maker-checker: you cannot approve a settlement you prepared.");
      await tx
        .update(settlements)
        .set({ status: "approved", approvedBy: ctx.user.id })
        .where(eq(settlements.id, s.id));
      await audit({
        action: "settlement.approved",
        entityType: "settlement",
        entityId: s.id,
        oldValues: { status: "draft" },
        newValues: { status: "approved", payable: s.payable },
      });
      return {};
    },
    ["/employees", "/payroll"],
  );
}

export async function paySettlementAction(input: unknown) {
  const res = await runAction(
    "payroll:process",
    async ({ ctx, tx, audit }) => {
      const { settlementId } = z.object({ settlementId: uuid }).parse(input);
      await tx.execute(sql`select id from settlements where id = ${settlementId} for update`);
      const [s] = await tx
        .select()
        .from(settlements)
        .where(
          and(eq(settlements.id, settlementId), eq(settlements.organizationId, ctx.organizationId)),
        );
      if (!s) throw new UserFacingError("Settlement not found.");
      if (s.status !== "approved")
        throw new UserFacingError(
          s.status === "paid"
            ? "This settlement was already paid."
            : "Approve the settlement first.",
        );
      await tx.update(settlements).set({ status: "paid" }).where(eq(settlements.id, s.id));
      await tx
        .insert(payments)
        .values({
          organizationId: ctx.organizationId,
          settlementId: s.id,
          employeeId: s.employeeId,
          amount: s.payable,
          idempotencyKey: `fnf:${s.id}`,
        })
        .onConflictDoNothing();

      // Recover outstanding loans and mark the employee as exited.
      const open = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.employeeId, s.employeeId), eq(loans.status, "active")));
      for (const l of open) {
        await tx
          .insert(loanRepayments)
          .values({
            organizationId: ctx.organizationId,
            loanId: l.id,
            month: `FNF-${s.lastWorkingDay.slice(0, 7)}`,
            amount: l.balance,
          })
          .onConflictDoNothing();
        await tx.update(loans).set({ balance: 0, status: "closed" }).where(eq(loans.id, l.id));
      }
      await tx
        .update(employees)
        .set({ status: "exited", exitDate: s.lastWorkingDay })
        .where(eq(employees.id, s.employeeId));
      await audit({
        action: "settlement.paid",
        entityType: "settlement",
        entityId: s.id,
        oldValues: { status: "approved" },
        newValues: { status: "paid", payable: s.payable, loansClosed: open.length },
      });
      return { settlementId: s.id };
    },
    ["/employees", "/payroll"],
  );
  if (!res.ok) return res;
  const { requireActionPermission } = await import("@/lib/auth/context");
  const ctx = await requireActionPermission("payroll:process");
  const sent = await dispatchRunPayments(
    { organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role },
    { settlementId: res.data.settlementId },
  );
  revalidatePath("/employees");
  return { ok: true as const, data: sent };
}
