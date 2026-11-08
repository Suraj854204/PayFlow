import "server-only";
import { and, eq, inArray, gte } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { departments, employees, payrollItems, payrollRuns } from "@/lib/db/schema";
import { addMonths } from "@/lib/payroll/period";
import {
  attritionRate,
  costTrend,
  departmentCost,
  headcountSeries,
  lastMonths,
  overtimeByMonth,
  yearOverYear,
  type ItemRow,
  type RunRow,
} from "./aggregate";

export interface ReportData {
  endMonth: string;
  months: string[];
  trend: RunRow[];
  departments: { department: string; cost: number; share: number }[];
  headcount: ReturnType<typeof headcountSeries>;
  attrition: number;
  overtime: ReturnType<typeof overtimeByMonth>;
  yoy: ReturnType<typeof yearOverYear>;
}

/** All report figures for the 12 months ending `endMonth`, from approved-or-later runs only. */
export async function loadReports(
  tx: Tx,
  organizationId: string,
  endMonth: string,
): Promise<ReportData> {
  const months = lastMonths(endMonth, 12);
  const from24 = addMonths(endMonth, -23);
  const runs = await tx
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, organizationId),
        inArray(payrollRuns.status, ["approved", "processing", "paid"]),
        gte(payrollRuns.month, from24),
      ),
    );
  const runRows: RunRow[] = runs.map((r) => ({
    month: r.month,
    gross: r.totalGross,
    net: r.totalNet,
    employerCost: r.totalEmployerCost,
    employees: r.employeeCount,
  }));

  const items = runs.length
    ? await tx
        .select({ i: payrollItems, month: payrollRuns.month, dept: departments.name })
        .from(payrollItems)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
        .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(
          and(
            eq(payrollItems.organizationId, organizationId),
            inArray(
              payrollItems.runId,
              runs.map((r) => r.id),
            ),
            eq(payrollItems.onHold, false),
          ),
        )
    : [];
  const itemRows: ItemRow[] = items.map(({ i, month, dept }) => ({
    month,
    department: dept ?? "No department",
    gross: i.gross,
    employerCost: i.employerCost,
    overtimeAmount: i.earnings.find((e) => e.code === "OVERTIME")?.amount ?? 0,
    overtimeMinutes: i.overtimeMinutes,
  }));

  const people = await tx
    .select({ joinDate: employees.joinDate, exitDate: employees.exitDate })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  const headcount = headcountSeries(people, months);
  const inWindow = itemRows.filter((i) => months.includes(i.month));
  const latest = [...runRows].sort((a, b) => b.month.localeCompare(a.month))[0]?.month;
  return {
    endMonth,
    months,
    trend: costTrend(runRows.filter((r) => months.includes(r.month))),
    departments: departmentCost(itemRows, latest),
    headcount,
    attrition: attritionRate(headcount),
    overtime: overtimeByMonth(inWindow),
    yoy: yearOverYear(runRows).filter((y) => months.includes(y.month)),
  };
}
