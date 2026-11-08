import type { Paise } from "@/lib/money";

export interface EwaPolicy {
  /** Share of earned-so-far take-home that can be drawn, 1 to 100. */
  maxPercent: number;
  /** Most that can be drawn in one month, in total. */
  monthlyCap: Paise;
  /** Requests up to this amount are approved automatically; larger ones wait for a person. */
  autoApproveLimit: Paise;
  maxRequestsPerMonth: number;
  /** Smallest request, so the process is not used for trivial amounts. */
  minAmount: Paise;
}

export const DEFAULT_EWA_POLICY: EwaPolicy = {
  maxPercent: 50,
  monthlyCap: 20_000_00,
  autoApproveLimit: 5_000_00,
  maxRequestsPerMonth: 3,
  minAmount: 500_00,
};

export interface EwaFacts {
  /** Take-home earned so far this month (pro-rata, after expected statutory deductions). */
  earnedSoFar: Paise;
  /** A full month's expected take-home. */
  netMonthly: Paise;
  /** Pending plus approved advances already taken this month. */
  alreadyDrawn: Paise;
  requestsThisMonth: number;
  /** Loan EMIs and other fixed deductions already due from this month's pay. */
  otherDeductionsDue: Paise;
}

/** The most that can be drawn right now. Never negative, always whole rupees. */
export function availableAdvance(f: EwaFacts, p: EwaPolicy): Paise {
  const byEarned = Math.floor((f.earnedSoFar * p.maxPercent) / 100);
  // Whatever is drawn comes back out of this month's pay, so it can never exceed what pay will be.
  const byPay = f.netMonthly - f.otherDeductionsDue;
  const limit = Math.min(byEarned, p.monthlyCap, byPay) - f.alreadyDrawn;
  return Math.max(0, Math.floor(limit / 100) * 100);
}

export type EwaDecision =
  { ok: true; outcome: "auto_approved" | "needs_approval" } | { ok: false; error: string };

export function decideRequest(amount: Paise, f: EwaFacts, p: EwaPolicy): EwaDecision {
  if (!Number.isInteger(amount) || amount % 100 !== 0)
    return { ok: false, error: "Enter a whole number of rupees." };
  if (amount < p.minAmount)
    return { ok: false, error: `The smallest request is ₹${p.minAmount / 100}.` };
  if (f.requestsThisMonth >= p.maxRequestsPerMonth)
    return { ok: false, error: `You can make ${p.maxRequestsPerMonth} requests a month.` };
  const avail = availableAdvance(f, p);
  if (amount > avail)
    return {
      ok: false,
      error:
        avail === 0
          ? "Nothing is available to draw right now."
          : `You can draw up to ₹${avail / 100} right now.`,
    };
  return { ok: true, outcome: amount <= p.autoApproveLimit ? "auto_approved" : "needs_approval" };
}

/** Pro-rata share of the month elapsed, with absent days (unpaid) taken out. */
export function earnedShare(daysElapsed: number, daysInMonth: number, unpaidDays: number): number {
  const paid = Math.max(0, Math.min(daysElapsed, daysInMonth) - Math.max(0, unpaidDays));
  return paid / daysInMonth;
}
