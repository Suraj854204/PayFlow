import { addMonths } from "@/lib/payroll/period";

export interface RunRow {
  month: string;
  gross: number;
  net: number;
  employerCost: number;
  employees: number;
}
export interface ItemRow {
  month: string;
  department: string;
  gross: number;
  employerCost: number;
  overtimeAmount: number;
  overtimeMinutes: number;
}
export interface PersonRow {
  joinDate: string;
  exitDate: string | null;
}

export const costTrend = (runs: RunRow[]) =>
  [...runs].sort((a, b) => a.month.localeCompare(b.month));

export function departmentCost(
  items: ItemRow[],
  month?: string,
): { department: string; cost: number; share: number }[] {
  const by = new Map<string, number>();
  for (const i of items)
    if (!month || i.month === month)
      by.set(i.department, (by.get(i.department) ?? 0) + i.employerCost);
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  return [...by.entries()]
    .map(([department, cost]) => ({ department, cost, share: total ? cost / total : 0 }))
    .sort((a, b) => b.cost - a.cost);
}

/** Headcount at the END of each month: joined on or before the month end and not exited before it. */
export function headcountSeries(
  people: PersonRow[],
  months: string[],
): { month: string; headcount: number; joined: number; exited: number }[] {
  return months.map((m) => {
    const start = `${m}-01`;
    const end = `${m}-31`;
    return {
      month: m,
      headcount: people.filter((p) => p.joinDate <= end && (!p.exitDate || p.exitDate > end))
        .length,
      joined: people.filter((p) => p.joinDate >= start && p.joinDate <= end).length,
      exited: people.filter((p) => p.exitDate && p.exitDate >= start && p.exitDate <= end).length,
    };
  });
}

/** Annualised attrition: exits in the window divided by average headcount, as a percentage. */
export function attritionRate(series: { headcount: number; exited: number }[]): number {
  if (series.length === 0) return 0;
  const avg = series.reduce((s, x) => s + x.headcount, 0) / series.length;
  if (avg === 0) return 0;
  const exits = series.reduce((s, x) => s + x.exited, 0);
  const annual = (exits / avg) * (12 / series.length);
  return Math.round(annual * 1000) / 10;
}

export function overtimeByMonth(
  items: ItemRow[],
): { month: string; minutes: number; amount: number }[] {
  const by = new Map<string, { minutes: number; amount: number }>();
  for (const i of items) {
    const cur = by.get(i.month) ?? { minutes: 0, amount: 0 };
    cur.minutes += i.overtimeMinutes;
    cur.amount += i.overtimeAmount;
    by.set(i.month, cur);
  }
  return [...by.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Same-month comparison with the previous year, as a percentage change (null when there is no base). */
export function yearOverYear(
  runs: RunRow[],
): { month: string; current: number; previous: number | null; changePct: number | null }[] {
  const by = new Map(runs.map((r) => [r.month, r.employerCost]));
  return costTrend(runs).map((r) => {
    const prev = by.get(addMonths(r.month, -12)) ?? null;
    return {
      month: r.month,
      current: r.employerCost,
      previous: prev,
      changePct: prev ? Math.round(((r.employerCost - prev) / prev) * 1000) / 10 : null,
    };
  });
}

/** Last n months ending at `endMonth`, oldest first. */
export const lastMonths = (endMonth: string, n: number) =>
  Array.from({ length: n }, (_, i) => addMonths(endMonth, i - (n - 1)));
