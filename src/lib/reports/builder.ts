import { monthEnd } from "@/lib/payroll/period";
import type { ChatChart } from "@/lib/db/schema";

export const REPORT_KINDS = [
  "attrition_by_department",
  "cost_by_department",
  "payroll_cost_trend",
  "headcount_trend",
  "overtime_trend",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABEL: Record<ReportKind, string> = {
  attrition_by_department: "Attrition by department",
  cost_by_department: "Payroll cost by department",
  payroll_cost_trend: "Payroll cost trend",
  headcount_trend: "Headcount trend",
  overtime_trend: "Overtime hours",
};

export interface Person {
  department: string;
  joinDate: string;
  exitDate: string | null;
}

/** Annualised attrition per department over `months` months ending at `endMonth` (YYYY-MM). */
export function attritionByDepartment(
  people: Person[],
  endMonth: string,
  months = 12,
): { department: string; leavers: number; avgHeadcount: number; ratePct: number }[] {
  const start = (() => {
    const [y, m] = endMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - months, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  })();
  const end = monthEnd(endMonth);
  const depts = [...new Set(people.map((p) => p.department))];
  return depts
    .map((department) => {
      const mine = people.filter((p) => p.department === department);
      const leavers = mine.filter(
        (p) => p.exitDate && p.exitDate >= start && p.exitDate <= end,
      ).length;
      // Average of headcount at the start and end of the window.
      const at = (d: string) =>
        mine.filter((p) => p.joinDate <= d && (!p.exitDate || p.exitDate > d)).length;
      const avg = (at(start) + at(end)) / 2;
      const ratePct = avg === 0 ? 0 : Math.round((leavers / avg) * (12 / months) * 1000) / 10;
      return { department, leavers, avgHeadcount: Math.round(avg * 10) / 10, ratePct };
    })
    .sort((a, b) => b.ratePct - a.ratePct || a.department.localeCompare(b.department));
}

export function chartFor(kind: ReportKind, points: { label: string; value: number }[]): ChatChart {
  const meta: Record<ReportKind, Omit<ChatChart, "points">> = {
    attrition_by_department: {
      kind: "bar",
      title: REPORT_LABEL.attrition_by_department + " (annualised, last 12 months)",
      unit: "percent",
    },
    cost_by_department: {
      kind: "donut",
      title: REPORT_LABEL.cost_by_department + " (latest month)",
      unit: "inr",
    },
    payroll_cost_trend: {
      kind: "line",
      title: REPORT_LABEL.payroll_cost_trend + " (employer cost)",
      unit: "inr",
    },
    headcount_trend: { kind: "line", title: REPORT_LABEL.headcount_trend, unit: "count" },
    overtime_trend: { kind: "bar", title: REPORT_LABEL.overtime_trend, unit: "count" },
  };
  return { ...meta[kind], points };
}
