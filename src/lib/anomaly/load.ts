import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import {
  anomalyDismissals,
  attendanceLocks,
  attendanceRecords,
  complianceItems,
  employees,
  expenseClaims,
  leaveRequests,
  payrollItems,
  payrollRuns,
} from "@/lib/db/schema";
import { addMonths, monthEnd, monthStart } from "@/lib/payroll/period";
import { preRunChecks, summarizeChecks, type Check, type CopilotFacts } from "@/lib/copilot/checks";
import { detectAnomalies, type Anomaly, type PreviousFacts, type RunItemFacts } from "./detect";

export interface RunAnalysis {
  month: string;
  status: string;
  anomalies: Anomaly[];
  dismissed: { key: string; reason: string; title: string }[];
  checks: Check[];
  summary: ReturnType<typeof summarizeChecks>;
}

const LIVE = ["approved", "processing", "paid"] as const;
const tdsOf = (d: { code: string; amount: number }[]) =>
  d.find((x) => x.code === "TDS")?.amount ?? 0;

/** Fingerprints stay in memory: salted hash of the decrypted account number, used only to compare. */
function fingerprint(orgId: string, enc: string | null): string | null {
  if (!enc) return null;
  try {
    return createHash("sha256")
      .update(`${orgId}:${decrypt(enc)}`)
      .digest("hex");
  } catch {
    return null;
  }
}

/** Runs every anomaly detector and the pre-run checklist for one payroll run. Read-only. */
export async function analyzeRun(
  tx: Tx,
  organizationId: string,
  runId: string,
  today: string,
): Promise<RunAnalysis | null> {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.organizationId, organizationId)));
  if (!run) return null;
  const month = run.month;
  const first = monthStart(month);
  const last = monthEnd(month);

  const rows = await tx
    .select({ i: payrollItems, e: employees })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, runId));

  const att = await tx
    .select({ e: attendanceRecords.employeeId, n: sql<number>`count(*)::int` })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.organizationId, organizationId),
        gte(attendanceRecords.date, first),
        lte(attendanceRecords.date, last),
        inArray(attendanceRecords.status, ["present", "half_day", "leave"]),
      ),
    )
    .groupBy(attendanceRecords.employeeId);
  const attDays = new Map(att.map((a) => [a.e, a.n]));
  const attendanceInUse = att.length > 0;
  const [lock] = await tx
    .select({ id: attendanceLocks.id })
    .from(attendanceLocks)
    .where(
      and(eq(attendanceLocks.organizationId, organizationId), eq(attendanceLocks.month, month)),
    );

  // Most recent earlier approved-or-later item per employee, within the last three months.
  const priorRows = await tx
    .select({
      emp: payrollItems.employeeId,
      net: payrollItems.net,
      gross: payrollItems.gross,
      deductions: payrollItems.deductions,
      month: payrollRuns.month,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(
      and(
        eq(payrollItems.organizationId, organizationId),
        inArray(payrollRuns.status, [...LIVE]),
        lt(payrollRuns.month, month),
        gte(payrollRuns.month, addMonths(month, -3)),
        eq(payrollItems.onHold, false),
      ),
    )
    .orderBy(desc(payrollRuns.month));
  const previous = new Map<string, PreviousFacts>();
  for (const p of priorRows)
    if (!previous.has(p.emp))
      previous.set(p.emp, { net: p.net, gross: p.gross, tds: tdsOf(p.deductions) });

  const facts: RunItemFacts[] = rows.map(({ i, e }) => ({
    employeeId: e.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
    gross: i.gross,
    net: i.net,
    totalDeductions: i.totalDeductions,
    tds: tdsOf(i.deductions),
    otherDeduction: i.otherDeduction,
    oneOffs:
      i.bonus +
      i.arrears +
      i.reimbursement +
      (i.earnings.find((x) => x.code === "OVERTIME")?.amount ?? 0),
    lopDays: Number(i.lopDays),
    onHold: i.onHold,
    accountFingerprint: fingerprint(organizationId, e.bankAccountEnc),
    joinDate: e.joinDate,
    exitDate: e.exitDate,
    attendanceDays: attDays.get(e.id) ?? 0,
  }));

  const all = detectAnomalies(month, facts, previous, { attendanceInUse });
  const dis = await tx.select().from(anomalyDismissals).where(eq(anomalyDismissals.runId, runId));
  const dismissedKeys = new Map(dis.map((d) => [d.key, d.reason]));
  const anomalies = all.filter((a) => !dismissedKeys.has(a.key));
  const dismissed = all
    .filter((a) => dismissedKeys.has(a.key))
    .map((a) => ({ key: a.key, title: a.title, reason: dismissedKeys.get(a.key)! }));

  const [pendingLeave] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.organizationId, organizationId),
        eq(leaveRequests.status, "pending"),
        lte(leaveRequests.fromDate, last),
        gte(leaveRequests.toDate, first),
      ),
    );
  const approved = await tx
    .select({ e: expenseClaims.employeeId, sum: sql<string>`sum(${expenseClaims.amount})` })
    .from(expenseClaims)
    .where(
      and(
        eq(expenseClaims.organizationId, organizationId),
        eq(expenseClaims.status, "approved"),
        isNull(expenseClaims.runId),
      ),
    )
    .groupBy(expenseClaims.employeeId);
  const included = new Map(rows.map(({ i }) => [i.employeeId, i.expenseAmount]));
  const unattached = approved.filter((a) => Number(a.sum) > (included.get(a.e) ?? 0)).length;
  const [overdue] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.organizationId, organizationId),
        eq(complianceItems.status, "pending"),
        lt(complianceItems.dueDate, today),
      ),
    );

  const live = rows.filter(({ i }) => !i.onHold);
  const cf: CopilotFacts = {
    month,
    employeesInRun: live.length,
    onHold: rows.length - live.length,
    missingBank: live
      .filter(({ e }) => !e.bankAccountEnc || !e.bankIfsc)
      .map(({ e }) => `${e.firstName} ${e.lastName}`.trim()),
    missingPan: live.filter(({ e }) => !e.panEnc).length,
    attendanceInUse,
    attendanceLocked: Boolean(lock),
    pendingLeaveInMonth: pendingLeave?.n ?? 0,
    unattachedApprovedExpenses: unattached,
    calcErrors: rows.filter(({ i }) => i.warnings.some((w) => w.severity === "error")).length,
    calcWarnings: rows.filter(
      ({ i }) =>
        !i.warnings.some((w) => w.severity === "error") &&
        i.warnings.some((w) => w.severity === "warning"),
    ).length,
    anomalyHigh: anomalies.filter((a) => a.severity === "high").length,
    anomalyMedium: anomalies.filter((a) => a.severity === "medium").length,
    overdueCompliance: overdue?.n ?? 0,
    zeroNet: live.filter(({ i }) => i.net <= 0).length,
  };
  const checks = preRunChecks(cf);
  return {
    month,
    status: run.status,
    anomalies,
    dismissed,
    checks,
    summary: summarizeChecks(checks),
  };
}
