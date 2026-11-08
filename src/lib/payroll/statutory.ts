import { assertPaise, percentOf, type Paise } from "@/lib/money";

/** Rounds paise to the nearest whole rupee (PF convention). */
export const roundToRupee = (p: Paise): Paise => Math.round(p / 100) * 100;
/** Rounds paise up to the next whole rupee (ESI convention). */
export const ceilToRupee = (p: Paise): Paise => Math.ceil(p / 100) * 100;

/**
 * EPFO wage ceiling. Rs 15,000 historically; Rs 25,000 from Sep 2026 per recent reporting. The date
 * and amount are verified against the notification by HR; an organisation can override the ceiling.
 */
export const PF_CEILING_OLD: Paise = 15_000_00;
export const PF_CEILING_NEW: Paise = 25_000_00;
export const PF_CEILING_CHANGE_MONTH = "2026-09";

export function pfCeiling(month: string, override?: Paise | null): Paise {
  if (override && override > 0) return override;
  return month >= PF_CEILING_CHANGE_MONTH ? PF_CEILING_NEW : PF_CEILING_OLD;
}

export interface PfResult {
  wages: Paise;
  employee: Paise;
  employerEpf: Paise;
  employerEps: Paise;
  edli: Paise;
  admin: Paise;
  employerTotal: Paise;
}

/**
 * Provident fund. `pfWages` is the earned PF-eligible pay (Basic + DA style components).
 * Employee 12%, employer EPF 3.67% + EPS 8.33%, EDLI 0.5%, admin 0.5%, on wages capped at the ceiling.
 * Set `voluntaryOnFullWages` to contribute on actual wages instead of the capped amount.
 */
export function computePf(pfWages: Paise, ceiling: Paise, voluntaryOnFullWages = false): PfResult {
  assertPaise(pfWages);
  const wages = Math.max(0, voluntaryOnFullWages ? pfWages : Math.min(pfWages, ceiling));
  const employee = roundToRupee(percentOf(wages, 1200));
  const cappedForPension = Math.max(0, Math.min(pfWages, ceiling));
  const eps = roundToRupee(percentOf(cappedForPension, 833));
  const total12 = roundToRupee(percentOf(wages, 1200));
  const employerEpf = Math.max(0, total12 - eps);
  const edli = roundToRupee(percentOf(cappedForPension, 50));
  const admin = roundToRupee(percentOf(cappedForPension, 50));
  return {
    wages,
    employee,
    employerEpf,
    employerEps: eps,
    edli,
    admin,
    employerTotal: employerEpf + eps + edli + admin,
  };
}

export const ESI_GROSS_LIMIT: Paise = 21_000_00;

export interface EsiResult {
  applicable: boolean;
  wages: Paise;
  employee: Paise;
  employer: Paise;
}

/**
 * ESI applies when the fixed (unprorated) monthly gross is Rs 21,000 or less. Contributions are on
 * the earned fixed gross (no overtime, bonus, arrears or reimbursements): employee 0.75%, employer
 * 3.25%, both rounded up to the next rupee.
 */
export function computeEsi(fixedMonthlyGross: Paise, earnedFixedGross: Paise): EsiResult {
  assertPaise(fixedMonthlyGross);
  if (fixedMonthlyGross > ESI_GROSS_LIMIT || fixedMonthlyGross <= 0) {
    return { applicable: false, wages: 0, employee: 0, employer: 0 };
  }
  const wages = Math.max(0, earnedFixedGross);
  return {
    applicable: true,
    wages,
    employee: ceilToRupee(percentOf(wages, 75)),
    employer: ceilToRupee(percentOf(wages, 325)),
  };
}
