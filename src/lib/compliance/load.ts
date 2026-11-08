import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { employees, payrollItems, payrollRuns } from "@/lib/db/schema";
import type { ReportItem } from "./reports";

/** Payroll lines for a month from runs that have been approved or later (held items excluded). */
export async function loadReportItems(
  tx: Tx,
  organizationId: string,
  month: string,
): Promise<ReportItem[]> {
  const rows = await tx
    .select({ i: payrollItems, e: employees })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(
      and(
        eq(payrollItems.organizationId, organizationId),
        eq(payrollRuns.month, month),
        inArray(payrollRuns.status, ["approved", "processing", "paid"]),
        eq(payrollItems.onHold, false),
      ),
    );
  return rows.map(({ i, e }) => ({
    employeeId: e.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
    code: e.employeeCode,
    uan: e.uan,
    esiNumber: e.esiNumber,
    pan: e.panEnc ? decrypt(e.panEnc) : null,
    state: e.workState,
    paidDays: Number(i.paidDays),
    lopDays: Number(i.lopDays),
    gross: i.gross,
    pfWages: i.pfWages,
    esiWages: i.esiWages,
    taxable: i.taxableEarnings,
    deductions: i.deductions,
    employer: i.employer,
  }));
}

/** Months (YYYY-MM) that have a run which is approved or later. */
export async function monthsWithRuns(
  tx: Tx,
  organizationId: string,
  from?: string,
  to?: string,
): Promise<string[]> {
  const conds = [
    eq(payrollRuns.organizationId, organizationId),
    inArray(payrollRuns.status, ["approved", "processing", "paid"]),
  ];
  if (from) conds.push(gte(payrollRuns.month, from));
  if (to) conds.push(lte(payrollRuns.month, to));
  const rows = await tx
    .select({ m: payrollRuns.month })
    .from(payrollRuns)
    .where(and(...conds));
  return [...new Set(rows.map((r) => r.m))].sort();
}
