export interface DayRecord {
  date: string;
  status: "present" | "half_day" | "absent" | "leave" | "holiday" | "weekly_off";
  lateMinutes?: number;
}

/**
 * Consecutive working days attended, counting back from today. Days off (weekly off, holiday, approved
 * leave) neither add to nor break the streak. An absence or half day ends it. Days with no record are
 * skipped only for today (the person may not have checked in yet); a missing earlier day is a break.
 */
export function currentStreak(
  records: DayRecord[],
  today: string,
  /** True for weekly offs and holidays, so a day with no record there does not break the streak. */
  isOff: (date: string) => boolean = () => false,
): { days: number; best: number } {
  const by = new Map(records.map((r) => [r.date, r]));
  const first = records.reduce((m, r) => (r.date < m ? r.date : m), today);
  let run = 0;
  let best = 0;
  let current = 0;
  // Walk forward to find the best run, and backward semantics for the current one.
  for (
    let d = first;
    d <= today;
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  ) {
    const r = by.get(d);
    if (!r) {
      if (d === today || isOff(d)) continue;
      run = 0;
      continue;
    }
    if (r.status === "present") {
      run++;
      best = Math.max(best, run);
    } else if (r.status === "holiday" || r.status === "weekly_off" || r.status === "leave") {
      continue;
    } else run = 0;
  }
  current = run;
  return { days: current, best };
}
