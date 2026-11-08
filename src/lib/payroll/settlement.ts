import type { Paise } from "@/lib/money";

export const GRATUITY_CAP: Paise = 20_00_000_00;
export const GRATUITY_MIN_YEARS = 5;

export interface Tenure {
  years: number;
  months: number;
  days: number;
}

/** Completed years, months and days between two ISO dates (join to last working day inclusive). */
export function tenureBetween(joinDate: string, lastDay: string): Tenure {
  const j = new Date(`${joinDate}T00:00:00Z`);
  const l = new Date(`${lastDay}T00:00:00Z`);
  l.setUTCDate(l.getUTCDate() + 1);
  let years = l.getUTCFullYear() - j.getUTCFullYear();
  let months = l.getUTCMonth() - j.getUTCMonth();
  let days = l.getUTCDate() - j.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

export interface GratuityResult {
  eligible: boolean;
  yearsCounted: number;
  amount: Paise;
  note: string;
}

/**
 * Gratuity = last drawn Basic (plus DA) / 26 x 15 x years of service, where 6+ months of a partial
 * year count as a full year. Needs 5 completed years unless death or disability (flag `exempt5y`).
 * Capped at Rs 20 lakh.
 */
export function computeGratuity(
  lastBasicMonthly: Paise,
  tenure: Tenure,
  exempt5y = false,
): GratuityResult {
  if (tenure.years < GRATUITY_MIN_YEARS && !exempt5y) {
    return {
      eligible: false,
      yearsCounted: tenure.years,
      amount: 0,
      note: `Not eligible: needs ${GRATUITY_MIN_YEARS} completed years (has ${tenure.years}).`,
    };
  }
  const yearsCounted = tenure.years + (tenure.months >= 6 ? 1 : 0);
  const raw = Math.round((lastBasicMonthly * 15 * yearsCounted) / 26);
  const amount = Math.min(raw, GRATUITY_CAP);
  return {
    eligible: true,
    yearsCounted,
    amount,
    note: raw > GRATUITY_CAP ? "Capped at Rs 20 lakh." : "Within the statutory cap.",
  };
}

/** Leave encashment per day = Basic / 26. */
export function leaveEncashment(basicMonthly: Paise, days: number): Paise {
  if (days < 0) throw new Error("Days cannot be negative");
  return Math.round((basicMonthly / 26) * days);
}

export interface SettlementInput {
  /** Net pay of the final (prorated) salary month, from the payroll engine. */
  finalSalaryNet: Paise;
  leaveEncashment: Paise;
  gratuity: Paise;
  noticeRecovery: Paise;
  loanOutstanding: Paise;
  otherRecovery: Paise;
}

export interface SettlementResult {
  payable: Paise;
  recoveries: Paise;
  lines: { label: string; amount: Paise }[];
}

export function computeSettlement(i: SettlementInput): SettlementResult {
  const recoveries = i.noticeRecovery + i.loanOutstanding + i.otherRecovery;
  const payable = i.finalSalaryNet + i.leaveEncashment + i.gratuity - recoveries;
  return {
    payable,
    recoveries,
    lines: [
      { label: "Final month salary (net)", amount: i.finalSalaryNet },
      { label: "Leave encashment", amount: i.leaveEncashment },
      { label: "Gratuity", amount: i.gratuity },
      { label: "Notice period recovery", amount: -i.noticeRecovery },
      { label: "Outstanding loan", amount: -i.loanOutstanding },
      { label: "Other recovery", amount: -i.otherRecovery },
    ],
  };
}
