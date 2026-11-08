import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  attendanceLocks,
  auditLogs,
  complianceItems,
  employees,
  expenseClaims,
  leaveRequests,
  organizations,
  payrollItems,
  payrollRuns,
  taxDeclarations,
  users,
} from "@/lib/db/schema";
import { addMonths } from "@/lib/payroll/period";
import { loadReports } from "@/lib/reports/load";
import { describeAction } from "./activity";
import { payrollCountdown } from "./countdown";
import { buildInsights, type InsightFacts } from "./insights";

const LIVE = ["approved", "processing", "paid"] as const;

export interface AdminDashboard {
  month: string;
  headcount: number;
  latestRun: {
    month: string;
    status: string;
    employerCost: number;
    net: number;
    employees: number;
    tds: number;
  } | null;
  pending: { payroll: number; leave: number; expenses: number; declarations: number };
  trend: { month: string; employerCost: number }[];
  departments: { department: string; cost: number; share: number }[];
  countdown: ReturnType<typeof payrollCountdown> & { runStatus: InsightFacts["currentMonthRun"] };
  activity: { id: string; who: string; what: string; at: string }[];
  insights: ReturnType<typeof buildInsights>;
}

/** Everything the admin dashboard shows, in one tenant transaction. `today` is an IST date. */
export async function loadAdminDashboard(
  tx: Tx,
  organizationId: string,
  today: string,
): Promise<AdminDashboard> {
  const month = today.slice(0, 7);
  const prevMonth = addMonths(month, -1);

  const [org] = await tx
    .select({ payDay: organizations.payDay, cutoffDay: organizations.cutoffDay })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const countdown = payrollCountdown(today, org?.payDay ?? 1, org?.cutoffDay ?? 25);

  const [{ n: headcount }] = await tx
    .select({ n: count() })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.status, "active"),
        isNull(employees.deletedAt),
      ),
    );

  const reports = await loadReports(tx, organizationId, month);
  const [latest] = await tx
    .select()
    .from(payrollRuns)
    .where(
      and(eq(payrollRuns.organizationId, organizationId), inArray(payrollRuns.status, [...LIVE])),
    )
    .orderBy(desc(payrollRuns.month))
    .limit(1);
  let tds = 0;
  if (latest) {
    const [t] = await tx
      .select({
        v: sql<string>`coalesce(sum((select coalesce(sum((d->>'amount')::bigint), 0) from jsonb_array_elements(${payrollItems.deductions}) d where d->>'code' = 'TDS')), 0)`,
      })
      .from(payrollItems)
      .where(and(eq(payrollItems.runId, latest.id), eq(payrollItems.onHold, false)));
    tds = Number(t?.v ?? 0);
  }

  const [{ n: payrollPending }] = await tx
    .select({ n: count() })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.organizationId, organizationId), eq(payrollRuns.status, "review")));
  const [{ n: leavePending }] = await tx
    .select({ n: count() })
    .from(leaveRequests)
    .where(
      and(eq(leaveRequests.organizationId, organizationId), eq(leaveRequests.status, "pending")),
    );
  const [{ n: expensesPending }] = await tx
    .select({ n: count() })
    .from(expenseClaims)
    .where(
      and(eq(expenseClaims.organizationId, organizationId), eq(expenseClaims.status, "submitted")),
    );
  const [{ n: declPending }] = await tx
    .select({ n: count() })
    .from(taxDeclarations)
    .where(
      and(
        eq(taxDeclarations.organizationId, organizationId),
        eq(taxDeclarations.status, "submitted"),
      ),
    );

  const [{ n: missingBank }] = await tx
    .select({ n: count() })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.status, "active"),
        isNull(employees.deletedAt),
        sql`(${employees.bankAccountEnc} is null or ${employees.bankIfsc} is null)`,
      ),
    );
  const [{ n: missingPan }] = await tx
    .select({ n: count() })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.status, "active"),
        isNull(employees.deletedAt),
        isNull(employees.panEnc),
      ),
    );
  const in30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [{ n: probation }] = await tx
    .select({ n: count() })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.status, "active"),
        gte(employees.probationEndDate, today),
        lte(employees.probationEndDate, in30),
      ),
    );

  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [{ n: overdue }] = await tx
    .select({ n: count() })
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.organizationId, organizationId),
        eq(complianceItems.status, "pending"),
        lt(complianceItems.dueDate, today),
      ),
    );
  const [{ n: dueSoon }] = await tx
    .select({ n: count() })
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.organizationId, organizationId),
        eq(complianceItems.status, "pending"),
        gte(complianceItems.dueDate, today),
        lte(complianceItems.dueDate, soon),
      ),
    );

  // Previous month is only a concern if the company has employees and the month has already ended.
  const [prevLock] = await tx
    .select({ id: attendanceLocks.id })
    .from(attendanceLocks)
    .where(
      and(eq(attendanceLocks.organizationId, organizationId), eq(attendanceLocks.month, prevMonth)),
    );
  const [thisRun] = await tx
    .select({ status: payrollRuns.status })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, organizationId),
        eq(payrollRuns.month, month),
        sql`${payrollRuns.status} <> 'cancelled'`,
      ),
    );

  const trend = reports.trend.map((t) => ({ month: t.month, employerCost: t.employerCost }));
  const last = trend[trend.length - 1];
  const before = trend[trend.length - 2];
  const costChangePct =
    last && before && before.employerCost > 0
      ? Math.round(((last.employerCost - before.employerCost) / before.employerCost) * 1000) / 10
      : null;

  const facts: InsightFacts = {
    pendingPayrollApprovals: payrollPending,
    pendingLeave: leavePending,
    pendingExpenses: expensesPending,
    pendingDeclarations: declPending,
    missingBank,
    missingPan,
    overdueCompliance: overdue,
    dueSoonCompliance: dueSoon,
    costChangePct,
    latestCost: last?.employerCost ?? null,
    attendanceUnlockedMonth: headcount > 0 && !prevLock ? prevMonth : null,
    probationEnding: probation,
    daysToCutoff: countdown.daysToCutoff,
    currentMonthRun: thisRun && thisRun.status !== "cancelled" ? thisRun.status : "none",
  };

  const log = await tx
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      at: auditLogs.createdAt,
      who: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.seq))
    .limit(8);

  return {
    month,
    headcount,
    latestRun: latest
      ? {
          month: latest.month,
          status: latest.status,
          employerCost: latest.totalEmployerCost,
          net: latest.totalNet,
          employees: latest.employeeCount,
          tds,
        }
      : null,
    pending: {
      payroll: payrollPending,
      leave: leavePending,
      expenses: expensesPending,
      declarations: declPending,
    },
    trend,
    departments: reports.departments,
    countdown: { ...countdown, runStatus: facts.currentMonthRun },
    activity: log.map((l) => ({
      id: l.id,
      who: l.who ?? "System",
      what: describeAction(l.action),
      at: l.at.toISOString(),
    })),
    insights: buildInsights(facts),
  };
}
