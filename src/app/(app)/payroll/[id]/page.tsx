import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { CopilotPanel } from "@/components/payroll/copilot-panel";
import { RunBoard, type ItemView, type PaymentView } from "@/components/payroll/run-board";
import { RUN_TONE } from "@/components/payroll/status";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/context";
import { analyzeRun } from "@/lib/anomaly/load";
import { withTenant } from "@/lib/db";
import { employees, payments, payrollItems, payrollRuns, payslips, users } from "@/lib/db/schema";
import { monthLabel } from "@/lib/payroll/period";
import { can } from "@/lib/rbac";

export const metadata = { title: "Payroll run" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("payroll:read");
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) notFound();

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, id.data), eq(payrollRuns.organizationId, ctx.organizationId)));
    if (!run) return null;
    const items = await tx
      .select({ i: payrollItems, e: employees })
      .from(payrollItems)
      .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
      .where(eq(payrollItems.runId, run.id))
      .orderBy(asc(employees.firstName));
    const pays = await tx
      .select({ p: payments, e: employees })
      .from(payments)
      .innerJoin(employees, eq(employees.id, payments.employeeId))
      .where(eq(payments.runId, run.id));
    const slips = await tx
      .select({ id: payslips.id, employeeId: payslips.employeeId })
      .from(payslips)
      .where(eq(payslips.runId, run.id));
    const userIds = [run.createdBy, run.approvedBy].filter((x): x is string => Boolean(x));
    const names = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const analysis = await analyzeRun(tx, ctx.organizationId, run.id, today);
    return { run, items, pays, slips, names, analysis };
  });
  if (!data) notFound();
  const { run, items, pays, slips, names, analysis } = data;
  const nameOf = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? null;
  const slipOf = new Map(slips.map((s) => [s.employeeId, s.id]));
  // Payslips are visible to Finance and HR from the run page only once they exist.
  const canSlips = can(ctx.role, "payslips:read_all");

  const itemViews: ItemView[] = items.map(({ i, e }) => ({
    id: i.id,
    employeeId: e.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
    code: e.employeeCode,
    paidDays: i.paidDays,
    lopDays: i.lopDays,
    overtimeMinutes: i.overtimeMinutes,
    arrears: i.arrears,
    bonus: i.bonus,
    reimbursement: i.reimbursement,
    otherDeduction: i.otherDeduction,
    loanEmi: i.loanEmi,
    gross: i.gross,
    deductions: i.totalDeductions,
    net: i.net,
    onHold: i.onHold,
    holdReason: i.holdReason,
    warnings: i.warnings,
    lines: [
      ...i.earnings.map((l) => ({ ...l, kind: "earning" as const })),
      ...i.deductions.map((l) => ({ ...l, kind: "deduction" as const })),
    ],
    payslipId: canSlips ? (slipOf.get(e.id) ?? null) : null,
  }));
  const payViews: PaymentView[] = pays.map(({ p, e }) => ({
    id: p.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
    amount: p.amount,
    status: p.status,
    failureReason: p.failureReason,
    providerRef: p.providerRef,
    provider: p.provider,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/payroll"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Payroll
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{monthLabel(run.month)}</h1>
          <Badge tone={RUN_TONE[run.status]}>{run.status}</Badge>
        </div>
      </div>
      {analysis && ["draft", "review"].includes(run.status) && (
        <CopilotPanel
          runId={run.id}
          analysis={analysis}
          canReview={can(ctx.role, "payroll:create") || can(ctx.role, "payroll:approve")}
          canAsk={can(ctx.role, "ai:use")}
        />
      )}
      <RunBoard
        run={{
          id: run.id,
          month: run.month,
          monthLabel: monthLabel(run.month),
          status: run.status,
          createdByName: nameOf(run.createdBy) ?? "Unknown",
          approvedByName: nameOf(run.approvedBy),
          totals: {
            gross: run.totalGross,
            deductions: run.totalDeductions,
            net: run.totalNet,
            cost: run.totalEmployerCost,
            count: run.employeeCount,
          },
        }}
        items={itemViews}
        payments={payViews}
        perms={{
          create: can(ctx.role, "payroll:create"),
          approve: can(ctx.role, "payroll:approve"),
          process: can(ctx.role, "payroll:process"),
          isMaker: run.createdBy === ctx.user.id || run.submittedBy === ctx.user.id,
        }}
      />
    </div>
  );
}
