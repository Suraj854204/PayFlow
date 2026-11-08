import { daysInMonth } from "@/lib/payroll/period";

export type DayKind = "working" | "weekly_off" | "holiday";

/** 0 = Sunday ... 6 = Saturday for an ISO date, independent of the server time zone. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function classifyDay(
  date: string,
  weeklyOffs: number[],
  holidays: ReadonlySet<string>,
): DayKind {
  if (holidays.has(date)) return "holiday";
  if (weeklyOffs.includes(weekday(date))) return "weekly_off";
  return "working";
}

export function monthDates(month: string): string[] {
  return Array.from(
    { length: daysInMonth(month) },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** All ISO dates from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (end < d) return out;
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > 400) throw new Error("Date range is too long");
  }
  return out;
}

export function workingDays(
  month: string,
  weeklyOffs: number[],
  holidays: ReadonlySet<string>,
): number {
  return monthDates(month).filter((d) => classifyDay(d, weeklyOffs, holidays) === "working").length;
}
