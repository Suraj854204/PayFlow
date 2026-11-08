export interface Countdown {
  cutoffDate: string;
  payDate: string;
  daysToCutoff: number;
  daysToPay: number;
}

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The next date on or after `today` that falls on day-of-month `day` (clamped to short months). */
export function nextDayOfMonth(today: string, day: number): string {
  const [y, m] = today.split("-").map(Number);
  for (let i = 0; i < 2; i++) {
    const first = Date.UTC(y, m - 1 + i, 1);
    const last = new Date(Date.UTC(y, m + i, 0)).getUTCDate();
    const candidate = first + (Math.min(Math.max(day, 1), last) - 1) * DAY;
    if (candidate >= utc(today)) return iso(candidate);
  }
  return today;
}

/** Days until the next attendance cutoff and the next pay day, from the company's pay schedule. */
export function payrollCountdown(today: string, payDay: number, cutoffDay: number): Countdown {
  const cutoffDate = nextDayOfMonth(today, cutoffDay);
  const payDate = nextDayOfMonth(today, payDay);
  return {
    cutoffDate,
    payDate,
    daysToCutoff: Math.round((utc(cutoffDate) - utc(today)) / DAY),
    daysToPay: Math.round((utc(payDate) - utc(today)) / DAY),
  };
}
