import { classifyDay, dateRange } from "@/lib/attendance/calendar";

export interface LeaveCalendar {
  weeklyOffs: number[];
  holidays: ReadonlySet<string>;
}

/** Working days a leave request consumes: weekly offs and holidays are free. A half day is 0.5. */
export function chargeableDays(
  from: string,
  to: string,
  cal: LeaveCalendar,
  halfDay = false,
): number {
  if (halfDay && from !== to) throw new Error("A half day must be a single date");
  const days = dateRange(from, to).filter(
    (d) => classifyDay(d, cal.weeklyOffs, cal.holidays) === "working",
  ).length;
  return halfDay ? (days > 0 ? 0.5 : 0) : days;
}

/** Splits an approved leave's chargeable days by calendar month (used to turn unpaid leave into LOP). */
export function daysByMonth(
  from: string,
  to: string,
  cal: LeaveCalendar,
  halfDay = false,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dateRange(from, to)) {
    if (classifyDay(d, cal.weeklyOffs, cal.holidays) !== "working") continue;
    const m = d.slice(0, 7);
    out[m] = (out[m] ?? 0) + (halfDay ? 0.5 : 1);
  }
  return out;
}

export function overlaps(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Remaining days, or an error message if the request does not fit. */
export function checkBalance(
  allotted: number,
  used: number,
  requested: number,
): { ok: true; remaining: number } | { ok: false; error: string } {
  const remaining = allotted - used;
  if (requested <= 0)
    return {
      ok: false,
      error: "This request falls entirely on weekly offs or holidays, so no leave is needed.",
    };
  if (requested > remaining + 1e-9)
    return {
      ok: false,
      error: `Not enough balance: ${remaining} day(s) left, ${requested} requested.`,
    };
  return { ok: true, remaining: remaining - requested };
}

/** Carry-forward into a new financial year, limited by the leave type. */
export function carryForward(unused: number, max: number): number {
  return Math.max(0, Math.min(unused, max));
}
