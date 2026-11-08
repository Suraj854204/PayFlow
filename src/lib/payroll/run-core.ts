import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action";
import type { ActionHelpers } from "@/lib/action-runner";
import type { Tx } from "@/lib/db";
import { payrollItems, payrollRuns } from "@/lib/db/schema";
import type { PayInputs } from "./engine";
import {
  calcItem,
  eligibleEmployees,
  gatherExtras,
  loadYtd,
  loanEmiFor,
  pfOverride,
  salaryAt,
  ZERO_INPUTS,
} from "./service";

export function currentMonthIst(): string {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  return d.toISOString().slice(0, 7);
}

export async function lockRun(tx: Tx, organizationId: string, runId: string) {
  await tx.execute(sql`select id from payroll_runs where id = ${runId} for update`);
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.organizationId, organizationId)));
  if (!run) throw new UserFacingError("Payroll run not found.");
  return run;
}

/** Recomputes run totals from items that are not on hold. */
export async function refreshTotals(tx: Tx, runId: string) {
  const [t] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      gross: sql<number>`coalesce(sum(${payrollItems.gross}),0)::bigint`,
      ded: sql<number>`coalesce(sum(${payrollItems.totalDeductions}),0)::bigint`,
      net: sql<number>`coalesce(sum(${payrollItems.net}),0)::bigint`,
      cost: sql<number>`coalesce(sum(${payrollItems.employerCost}),0)::bigint`,
    })
    .from(payrollItems)
    .where(and(eq(payrollItems.runId, runId), eq(payrollItems.onHold, false)));
  await tx
    .update(payrollRuns)
    .set({
      employeeCount: Number(t.n),
      totalGross: Number(t.gross),
      totalDeductions: Number(t.ded),
      totalNet: Number(t.net),
      totalEmployerCost: Number(t.cost),
    })
    .where(eq(payrollRuns.id, runId));
}

/** Creates a draft payroll run for a month inside the caller's transaction. */
export async function createRunTx({ ctx, tx, audit }: ActionHelpers, month: string) {
  if (month > currentMonthIst())
    throw new UserFacingError("You cannot run payroll for a future month.");
  const orgId = ctx.organizationId;

  const [existing] = await tx
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.month, month),
        sql`${payrollRuns.status} <> 'cancelled'`,
      ),
    );
  if (existing) throw new UserFacingError("A payroll run already exists for this month.");

  const emps = await eligibleEmployees(tx, orgId, month);
  const ytd = await loadYtd(
    tx,
    orgId,
    month,
    emps.map((e) => e.id),
  );
  const override = await pfOverride(tx, orgId);

  const rows = [];
  const skipped: string[] = [];
  for (const e of emps) {
    const salary = await salaryAt(tx, orgId, e.id, month);
    if (!salary) {
      skipped.push(`${e.firstName} ${e.lastName}`.trim());
      continue;
    }
    const emi = await loanEmiFor(tx, orgId, e.id, month);
    const ex = await gatherExtras(tx, orgId, e, salary, month);
    const inputs: PayInputs = {
      ...ZERO_INPUTS,
      loanEmi: emi,
      lopDays: ex.attendance?.lopDays ?? 0,
      overtimeMinutes: ex.attendance?.overtimeMinutes ?? 0,
    };
    rows.push({
      employeeId: e.id,
      ...calcItem(
        e,
        salary,
        month,
        inputs,
        ytd.get(e.id) ?? { taxable: 0, tds: 0, pf: 0, pt: 0 },
        override,
        { expenseAmount: ex.expenseAmount, declarations: ex.declarations },
      ),
    });
  }
  if (rows.length === 0)
    throw new UserFacingError(
      "No employees with a salary are eligible for this month. Assign salaries first.",
    );

  const [run] = await tx
    .insert(payrollRuns)
    .values({ organizationId: orgId, month, createdBy: ctx.user.id })
    .returning({ id: payrollRuns.id });
  await tx
    .insert(payrollItems)
    .values(rows.map((r) => ({ ...r, organizationId: orgId, runId: run.id })));
  await refreshTotals(tx, run.id);
  await audit({
    action: "payroll_run.created",
    entityType: "payroll_run",
    entityId: run.id,
    newValues: { month, employees: rows.length, skippedNoSalary: skipped.length },
    metadata: skipped.length ? { skipped } : undefined,
  });
  return { id: run.id, skipped };
}

/** Moves a draft run to review (maker step). */
export async function submitRunTx({ ctx, tx, audit }: ActionHelpers, runId: string) {
  const run = await lockRun(tx, ctx.organizationId, runId);
  if (run.status !== "draft")
    throw new UserFacingError("Only a draft run can be submitted for review.");
  const items = await tx.select().from(payrollItems).where(eq(payrollItems.runId, runId));
  const active = items.filter((i) => !i.onHold);
  if (active.length === 0) throw new UserFacingError("There are no payable items in this run.");
  const blocking = active.filter((i) => i.warnings.some((w) => w.severity === "error"));
  if (blocking.length)
    throw new UserFacingError(
      `${blocking.length} item(s) have errors. Fix or hold them before submitting.`,
    );
  await tx
    .update(payrollRuns)
    .set({ status: "review", submittedBy: ctx.user.id, submittedAt: new Date() })
    .where(eq(payrollRuns.id, runId));
  await audit({
    action: "payroll_run.submitted",
    entityType: "payroll_run",
    entityId: runId,
    oldValues: { status: "draft" },
    newValues: { status: "review", totalNet: run.totalNet },
  });
  return {};
}
