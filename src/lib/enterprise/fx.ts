/**
 * Display-only conversion. Payroll, payslips and statutory returns are always in INR. The company
 * enters its own rate (units of foreign currency per 1 INR), so these figures are indicative only.
 */
export const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (c: string): c is Currency =>
  (CURRENCIES as readonly string[]).includes(c);

/** paise -> foreign minor units (cents), rounded half up. */
export function convertPaise(paise: number, perInr: number): number {
  if (!Number.isFinite(perInr) || perInr <= 0) throw new Error("Rate must be positive");
  return Math.round(paise * perInr);
}

export function formatForeign(minor: number, currency: Currency, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

/** "1 USD = ₹x" for the settings screen. */
export const inrPerUnit = (perInr: number) => 1 / perInr;
