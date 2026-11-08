/** Helpers for payroll months ("YYYY-MM") and Indian financial years (April to March). */

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseMonth(month: string): { year: number; month: number } {
  if (!MONTH_RE.test(month)) throw new Error(`Invalid payroll month: ${month}`);
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

export function daysInMonth(month: string): number {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) =>
  `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** Financial year start year: Apr 2026 to Mar 2027 is FY 2026. */
export function fyStartYear(month: string): number {
  const { year, month: m } = parseMonth(month);
  return m >= 4 ? year : year - 1;
}

export const fyLabel = (month: string) => {
  const y = fyStartYear(month);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

/** First payroll month of the FY that contains `month`. */
export const fyFirstMonth = (month: string) => `${fyStartYear(month)}-04`;

/** Months remaining in the FY including `month` itself (April = 12, March = 1). */
export function monthsLeftInFy(month: string): number {
  const { month: m } = parseMonth(month);
  return m >= 4 ? 16 - m : 4 - m;
}

export function addMonths(month: string, n: number): string {
  const { year, month: m } = parseMonth(month);
  const idx = year * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
