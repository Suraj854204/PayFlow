import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { attendanceRecords, employees, ewaRequests, ewaSettings, loans } from "@/lib/db/schema";
import { daysInMonth, monthStart } from "@/lib/payroll/period";
import { calcItem, loadYtd, pfOverride, salaryAt, ZERO_INPUTS } from "@/lib/payroll/service";
import { DEFAULT_EWA_POLICY, earnedShare, type EwaFacts, type EwaPolicy } from "./rules";

export async function loadPolicy(tx: Tx, orgId: string): Promise<EwaPolicy & { enabled: boolean }> {
  const [s] = await tx.select().from(ewaSettings).where(eq(ewaSettings.organizationId, orgId));
  if (!s) return { ...DEFAULT_EWA_POLICY, enabled: false };
  return {
    enabled: s.enabled,
    maxPercent: s.maxPercent,
    monthlyCap: s.monthlyCap,
    autoApproveLimit: s.autoApproveLimit,
    maxRequestsPerMonth: s.maxRequestsPerMonth,
    minAmount: DEFAULT_EWA_POLICY.minAmount,
  };
}

/** What this person has earned so far this month and what they can still draw. Reads only. */
export async function loadFacts(
  tx: Tx,
  orgId: string,
  employeeId: string,
  month: string,
  todayIst: string,
): Promise<EwaFacts | null> {
  const [emp] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, orgId)));
  if (!emp) return null;
  const salary = await salaryAt(tx, orgId, employeeId, month);
  if (!salary) return null;
  const ytd = (await loadYtd(tx, orgId, month, [employeeId])).get(employeeId) ?? {
    taxable: 0,
    tds: 0,
    pf: 0,
    pt: 0,
  };
  const item = calcItem(emp, salary, month, ZERO_INPUTS, ytd, await pfOverride(tx, orgId));
  const net = item.net ?? 0;
  const dim = daysInMonth(month);
  const elapsed = todayIst.startsWith(month) ? Number(todayIst.slice(8, 10)) : dim;

  const att = await tx
    .select({ status: attendanceRecords.status })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, employeeId),
        sql`${attendanceRecords.date} >= ${monthStart(month)} and ${attendanceRecords.date} <= ${todayIst}`,
        inArray(attendanceRecords.status, ["absent", "half_day"]),
      ),
    );
  const unpaid = att.reduce((s, a) => s + (a.status === "absent" ? 1 : 0.5), 0);
  const share = earnedShare(elapsed, dim, unpaid);

  const reqs = await tx
    .select({ amount: ewaRequests.amount })
    .from(ewaRequests)
    .where(
      and(
        eq(ewaRequests.employeeId, employeeId),
        eq(ewaRequests.month, month),
        inArray(ewaRequests.status, ["pending", "approved"]),
      ),
    );
  const emis = await tx
    .select({ emi: loans.emi, balance: loans.balance, id: loans.id })
    .from(loans)
    .where(and(eq(loans.employeeId, employeeId), eq(loans.status, "active")));
  const advanceIds = new Set(
    (
      await tx
        .select({ id: ewaRequests.loanId })
        .from(ewaRequests)
        .where(and(eq(ewaRequests.employeeId, employeeId), eq(ewaRequests.month, month)))
    ).map((r) => r.id),
  );
  // EMIs from other loans reduce what pay can bear; this month's own advances are counted via alreadyDrawn.
  const otherEmis = emis
    .filter((l) => !advanceIds.has(l.id))
    .reduce((s, l) => s + Math.min(l.emi, l.balance), 0);

  return {
    earnedSoFar: Math.floor(net * share),
    netMonthly: net,
    alreadyDrawn: reqs.reduce((s, r) => s + r.amount, 0),
    requestsThisMonth: reqs.length,
    otherDeductionsDue: otherEmis,
  };
}
