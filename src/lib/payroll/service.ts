import "server-only";
import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { daysByMonth } from "@/lib/leave";
import { loadCalendar } from "@/lib/workforce/calendar";
import { hraExemption, NO_DECLARATIONS, SECTION_80D_CAP, type Declarations } from "./tax";
import type { Tx } from "@/lib/db";
import {
  attendanceLocks,
  attendanceRecords,
  employeeSalaries,
  employees,
  expenseClaims,
  leaveRequests,
  leaveTypes,
  taxDeclarations,
  loans,
  organizations,
  payrollItems,
  payrollRuns,
  settlements,
  type PayLineJson,
} from "@/lib/db/schema";
import { computePayItem, ZERO_INPUTS, type PayInputs } from "./engine";
import { daysInMonth, fyFirstMonth, fyStartYear, monthEnd } from "./period";
import type { Regime } from "./tax";

export type ItemValues = typeof payrollItems.$inferInsert;

interface YtdTotals {
  taxable: number;
  tds: number;
  pf: number;
  pt: number;
}

const sumCode = (lines: PayLineJson[], code: string) =>
  lines.find((l) => l.code === code)?.amount ?? 0;

/** Year-to-date figures per employee from earlier (non-cancelled) runs in the same financial year. */
export async function loadYtd(
  tx: Tx,
  organizationId: string,
  month: string,
  employeeIds: string[],
): Promise<Map<string, YtdTotals>> {
  const out = new Map<string, YtdTotals>();
  if (employeeIds.length === 0) return out;
  const rows = await tx
    .select({
      employeeId: payrollItems.employeeId,
      taxable: payrollItems.taxableEarnings,
      deductions: payrollItems.deductions,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(
      and(
        eq(payrollItems.organizationId, organizationId),
        inArray(payrollItems.employeeId, employeeIds),
        ne(payrollRuns.status, "cancelled"),
        gte(payrollRuns.month, fyFirstMonth(month)),
        lt(payrollRuns.month, month),
      ),
    );
  for (const r of rows) {
    const t = out.get(r.employeeId) ?? { taxable: 0, tds: 0, pf: 0, pt: 0 };
    t.taxable += r.taxable;
    t.tds += sumCode(r.deductions, "TDS");
    t.pf += sumCode(r.deductions, "PF");
    t.pt += sumCode(r.deductions, "PT");
    out.set(r.employeeId, t);
  }
  return out;
}

type EmployeeRow = typeof employees.$inferSelect;

interface SalaryRow {
  ctcAnnual: number;
  breakdown: typeof employeeSalaries.$inferSelect.breakdown;
}

function payableDays(emp: EmployeeRow, month: string): number {
  const dim = daysInMonth(month);
  const start = `${month}-01`;
  let first = 1;
  let last = dim;
  if (emp.joinDate > start) first = Number(emp.joinDate.slice(8, 10));
  if (emp.exitDate && emp.exitDate.slice(0, 7) === month) last = Number(emp.exitDate.slice(8, 10));
  return Math.max(0, last - first + 1);
}

export function calcItem(
  emp: EmployeeRow,
  salary: SalaryRow,
  month: string,
  inputs: PayInputs,
  ytd: YtdTotals,
  pfCeilingOverride: number | null,
  extras: { expenseAmount?: number; declarations?: Declarations } = {},
): Omit<ItemValues, "organizationId" | "runId" | "employeeId"> {
  const days = payableDays(emp, month);
  const expenseAmount = extras.expenseAmount ?? 0;
  // Loss of pay can never exceed the days the employee was payable in the month.
  const lopDays = Math.min(inputs.lopDays, Math.floor(days * 2) / 2);
  const r = computePayItem({
    month,
    gender: emp.gender,
    workState: emp.workState,
    regime: (emp.taxRegime === "old" ? "old" : "new") as Regime,
    hasPan: Boolean(emp.panEnc),
    lines: salary.breakdown,
    inputs: { ...inputs, lopDays, reimbursement: inputs.reimbursement + expenseAmount },
    pfCeilingOverride,
    declarations: extras.declarations,
    ytd,
    payableDaysOverride: days,
  });
  return {
    lopDays: String(lopDays),
    expenseAmount,
    pfWages: r.pfWages,
    esiWages: r.esiWages,
    overtimeMinutes: inputs.overtimeMinutes,
    arrears: inputs.arrears,
    bonus: inputs.bonus,
    reimbursement: inputs.reimbursement,
    otherDeduction: inputs.otherDeduction,
    loanEmi: inputs.loanEmi,
    earnings: r.earnings,
    deductions: r.deductions,
    employer: r.employer,
    warnings: r.warnings,
    gross: r.gross,
    totalDeductions: r.totalDeductions,
    net: r.net,
    employerCost: r.employerCost,
    taxableEarnings: r.taxableEarnings,
    paidDays: String(r.paidDays),
    ctcAnnual: salary.ctcAnnual,
  };
}

/** The salary revision in force on the last day of the month. */
export async function salaryAt(
  tx: Tx,
  organizationId: string,
  employeeId: string,
  month: string,
): Promise<SalaryRow | null> {
  const [row] = await tx
    .select({ ctcAnnual: employeeSalaries.ctcAnnual, breakdown: employeeSalaries.breakdown })
    .from(employeeSalaries)
    .where(
      and(
        eq(employeeSalaries.organizationId, organizationId),
        eq(employeeSalaries.employeeId, employeeId),
        lte(employeeSalaries.effectiveFrom, monthEnd(month)),
      ),
    )
    .orderBy(sql`${employeeSalaries.effectiveFrom} desc`)
    .limit(1);
  return row ?? null;
}

export async function pfOverride(tx: Tx, organizationId: string): Promise<number | null> {
  const [o] = await tx
    .select({ c: organizations.pfWageCeiling })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return o?.c ?? null;
}

export async function loanEmiFor(
  tx: Tx,
  organizationId: string,
  employeeId: string,
  month: string,
): Promise<number> {
  const rows = await tx
    .select({ emi: loans.emi, balance: loans.balance })
    .from(loans)
    .where(
      and(
        eq(loans.organizationId, organizationId),
        eq(loans.employeeId, employeeId),
        eq(loans.status, "active"),
        lte(loans.startMonth, month),
      ),
    );
  return rows.reduce((s, l) => s + Math.min(l.emi, l.balance), 0);
}

/** Employees who should be paid for the month, and the ones skipped with a reason. */
export async function eligibleEmployees(tx: Tx, organizationId: string, month: string) {
  const rows = await tx
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        isNull(employees.deletedAt),
        lte(employees.joinDate, monthEnd(month)),
        inArray(employees.status, ["active", "probation", "notice", "exited"]),
      ),
    );
  const start = `${month}-01`;
  // Anyone with a full-and-final settlement for this month is paid through it, not the monthly run.
  const fnf = await tx
    .select({ employeeId: settlements.employeeId })
    .from(settlements)
    .where(
      and(
        eq(settlements.organizationId, organizationId),
        gte(settlements.lastWorkingDay, start),
        lte(settlements.lastWorkingDay, monthEnd(month)),
      ),
    );
  const inFnf = new Set(fnf.map((f) => f.employeeId));
  return rows.filter(
    (e) => !inFnf.has(e.id) && (e.status !== "exited" || (e.exitDate && e.exitDate >= start)),
  );
}

export { ZERO_INPUTS };

export interface Extras {
  /** Approved, not-yet-paid expense claims. */
  expenseAmount: number;
  declarations: Declarations;
  /** Present only when the month's attendance is locked; otherwise LOP and overtime stay manual. */
  attendance: { lopDays: number; overtimeMinutes: number } | null;
}

/** Pulls expenses, tax declarations and (if locked) attendance into payroll inputs for one employee. */
export async function gatherExtras(
  tx: Tx,
  organizationId: string,
  emp: EmployeeRow,
  salary: SalaryRow,
  month: string,
): Promise<Extras> {
  const [claims] = await tx
    .select({ total: sql<number>`coalesce(sum(${expenseClaims.amount}),0)::bigint` })
    .from(expenseClaims)
    .where(
      and(
        eq(expenseClaims.employeeId, emp.id),
        eq(expenseClaims.status, "approved"),
        isNull(expenseClaims.runId),
      ),
    );

  // Declarations only matter in the old regime. Submitted or verified both count; rejected do not.
  let declarations = NO_DECLARATIONS;
  if (emp.taxRegime === "old") {
    const [d] = await tx
      .select()
      .from(taxDeclarations)
      .where(
        and(
          eq(taxDeclarations.employeeId, emp.id),
          eq(taxDeclarations.fyStart, fyStartYear(month)),
          inArray(taxDeclarations.status, ["submitted", "verified"]),
        ),
      );
    if (d) {
      const line = (code: string) =>
        (salary.breakdown.find((l) => l.code === code)?.monthly ?? 0) * 12;
      declarations = {
        section80C: d.data.section80C,
        section80D: Math.min(d.data.section80D, SECTION_80D_CAP),
        hraExemption: hraExemption({
          basicAnnual: line("BASIC"),
          hraAnnual: line("HRA"),
          rentAnnual: d.data.annualRent,
          metro: d.data.metro,
        }),
        otherDeductions: d.data.otherDeductions,
      };
    }
  }

  let attendance: Extras["attendance"] = null;
  const [lock] = await tx
    .select({ id: attendanceLocks.id })
    .from(attendanceLocks)
    .where(
      and(eq(attendanceLocks.organizationId, organizationId), eq(attendanceLocks.month, month)),
    );
  if (lock) {
    const start = `${month}-01`;
    const end = monthEnd(month);
    const recs = await tx
      .select({ status: attendanceRecords.status, ot: attendanceRecords.overtimeMinutes })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.employeeId, emp.id),
          gte(attendanceRecords.date, start),
          lte(attendanceRecords.date, end),
        ),
      );
    let lop = recs.reduce(
      (s, r) => s + (r.status === "absent" ? 1 : r.status === "half_day" ? 0.5 : 0),
      0,
    );
    const overtimeMinutes = recs.reduce((s, r) => s + r.ot, 0);
    const unpaid = await tx
      .select({
        from: leaveRequests.fromDate,
        to: leaveRequests.toDate,
        half: leaveRequests.halfDay,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.employeeId, emp.id),
          eq(leaveRequests.status, "approved"),
          eq(leaveTypes.isPaid, false),
          lte(leaveRequests.fromDate, end),
          gte(leaveRequests.toDate, start),
        ),
      );
    if (unpaid.length) {
      const cal = await loadCalendar(tx, organizationId, start, end);
      for (const u of unpaid) lop += daysByMonth(u.from, u.to, cal, u.half)[month] ?? 0;
    }
    attendance = { lopDays: lop, overtimeMinutes };
  }
  return { expenseAmount: Number(claims.total), declarations, attendance };
}
