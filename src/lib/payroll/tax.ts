import { assertPaise, type Paise } from "@/lib/money";

/**
 * Income tax for salaried individuals below 60, FY 2026-27 (AY 2027-28). Slabs are unchanged from
 * FY 2025-26 per Budget 2026 coverage. All amounts are integer paise.
 */
export type Regime = "new" | "old";

const L = 100_000_00; // one lakh in paise
const CR = 100 * L;

interface Slab {
  upTo: number;
  bps: number;
}

const SLABS: Record<Regime, Slab[]> = {
  new: [
    { upTo: 4 * L, bps: 0 },
    { upTo: 8 * L, bps: 500 },
    { upTo: 12 * L, bps: 1000 },
    { upTo: 16 * L, bps: 1500 },
    { upTo: 20 * L, bps: 2000 },
    { upTo: 24 * L, bps: 2500 },
    { upTo: Infinity, bps: 3000 },
  ],
  old: [
    { upTo: 2.5 * L, bps: 0 },
    { upTo: 5 * L, bps: 500 },
    { upTo: 10 * L, bps: 2000 },
    { upTo: Infinity, bps: 3000 },
  ],
};

export const STANDARD_DEDUCTION: Record<Regime, Paise> = { new: 75_000_00, old: 50_000_00 };
const REBATE = {
  new: { limit: 12 * L, max: 60_000_00 },
  old: { limit: 5 * L, max: 12_500_00 },
};

/** Surcharge thresholds. The new regime caps surcharge at 25%. */
const SURCHARGE: Record<Regime, { above: number; bps: number }[]> = {
  new: [
    { above: 50 * L, bps: 1000 },
    { above: CR, bps: 1500 },
    { above: 2 * CR, bps: 2500 },
  ],
  old: [
    { above: 50 * L, bps: 1000 },
    { above: CR, bps: 1500 },
    { above: 2 * CR, bps: 2500 },
    { above: 5 * CR, bps: 3700 },
  ],
};
const CESS_BPS = 400;

const bps = (amount: number, rate: number) => Math.round((amount * rate) / 10_000);

/** Tax on slabs only, before rebate, surcharge and cess. */
export function slabTax(regime: Regime, taxable: Paise): Paise {
  let tax = 0;
  let lower = 0;
  for (const s of SLABS[regime]) {
    if (taxable > lower) tax += bps(Math.min(taxable, s.upTo) - lower, s.bps);
    lower = s.upTo;
    if (taxable <= s.upTo) break;
  }
  return tax;
}

function afterRebate(regime: Regime, taxable: Paise): Paise {
  const base = slabTax(regime, taxable);
  const r = REBATE[regime];
  if (taxable <= r.limit) return Math.max(0, base - Math.min(base, r.max));
  // Marginal relief: tax cannot exceed the income above the rebate limit (new regime only).
  if (regime === "new") return Math.min(base, taxable - r.limit);
  return base;
}

export interface TaxResult {
  slabTax: Paise;
  taxAfterRebate: Paise;
  surcharge: Paise;
  cess: Paise;
  total: Paise;
}

/** Full annual tax for a taxable income (after deductions), rounded to the nearest rupee. */
export function annualTax(regime: Regime, taxableIncome: Paise): TaxResult {
  assertPaise(taxableIncome);
  const taxable = Math.max(0, Math.floor(taxableIncome / 1000) * 1000); // round down to Rs 10 (s.288A)
  const base = afterRebate(regime, taxable);

  let surchargeAmt = 0;
  const levels = SURCHARGE[regime];
  const idx = levels.reduce((acc, l, i) => (taxable > l.above ? i : acc), -1);
  if (idx >= 0 && base > 0) {
    const lvl = levels[idx];
    const prevRate = idx > 0 ? levels[idx - 1].bps : 0;
    const full = bps(base, lvl.bps);
    // Marginal relief: tax plus surcharge must not exceed tax at the threshold (with the previous
    // surcharge rate) plus the income earned above the threshold.
    const atThreshold = afterRebate(regime, lvl.above);
    const limit = atThreshold + bps(atThreshold, prevRate) + (taxable - lvl.above);
    surchargeAmt = Math.max(0, Math.min(base + full, limit) - base);
  }

  const beforeCess = base + surchargeAmt;
  const cess = bps(beforeCess, CESS_BPS);
  const total = Math.round((beforeCess + cess) / 100) * 100;
  return {
    slabTax: slabTax(regime, taxable),
    taxAfterRebate: base,
    surcharge: surchargeAmt,
    cess,
    total,
  };
}

export interface Declarations {
  /** Old regime only. 80C is capped at Rs 1.5 lakh together with employee PF. */
  section80C: Paise;
  section80D: Paise;
  hraExemption: Paise;
  otherDeductions: Paise;
}
export const NO_DECLARATIONS: Declarations = {
  section80C: 0,
  section80D: 0,
  hraExemption: 0,
  otherDeductions: 0,
};
export const SECTION_80C_CAP = 1_50_000_00;

export interface TdsInput {
  regime: Regime;
  /** Months left in the FY including the current one (1 to 12). */
  monthsLeft: number;
  /** Taxable earnings in this payroll month (recurring + one-off). */
  currentTaxable: Paise;
  /** The recurring part of this month's taxable earnings, projected for the remaining months. */
  currentRecurringTaxable: Paise;
  /** Taxable earnings and TDS already booked in earlier months of this FY. */
  ytdTaxable: Paise;
  ytdTds: Paise;
  /** Employee PF and Professional Tax already deducted this FY plus this month. Old regime deductions. */
  ytdPf: Paise;
  currentPf: Paise;
  ytdPt: Paise;
  currentPt: Paise;
  declarations: Declarations;
  hasPan: boolean;
}

export interface TdsResult {
  tds: Paise;
  projectedAnnualTaxable: Paise;
  projectedTaxableIncome: Paise;
  annualTax: Paise;
  notes: string[];
}

/**
 * TDS for one month: project the year, compute annual tax, subtract TDS already deducted, and spread
 * the balance over the remaining months. Without a PAN, TDS is at least 20% of the month's taxable
 * earnings (section 206AA).
 */
export function monthlyTds(i: TdsInput): TdsResult {
  const left = Math.max(1, Math.min(12, i.monthsLeft));
  const notes: string[] = [];
  const projected = i.ytdTaxable + i.currentTaxable + i.currentRecurringTaxable * (left - 1);

  let deductions = STANDARD_DEDUCTION[i.regime];
  if (i.regime === "old") {
    const projectedPf = i.ytdPf + i.currentPf * left;
    const projectedPt = i.ytdPt + i.currentPt * left;
    const c80 = Math.min(SECTION_80C_CAP, i.declarations.section80C + projectedPf);
    deductions +=
      c80 +
      projectedPt +
      i.declarations.section80D +
      i.declarations.hraExemption +
      i.declarations.otherDeductions;
  }

  const taxableIncome = Math.max(0, projected - deductions);
  const { total } = annualTax(i.regime, taxableIncome);
  let tds = Math.max(0, Math.round((total - i.ytdTds) / left / 100) * 100);

  if (!i.hasPan) {
    const floor = Math.round((i.currentTaxable * 0.2) / 100) * 100;
    if (floor > tds) {
      tds = floor;
      notes.push("No PAN on file: TDS deducted at the higher rate of 20%.");
    }
  }
  return {
    tds,
    projectedAnnualTaxable: projected,
    projectedTaxableIncome: taxableIncome,
    annualTax: total,
    notes,
  };
}

export interface HraInput {
  basicAnnual: Paise;
  hraAnnual: Paise;
  rentAnnual: Paise;
  metro: boolean;
}

/** Section 10(13A) exemption: the least of HRA received, rent less 10% of Basic, and 50% (metro) or 40% of Basic. */
export function hraExemption(i: HraInput): Paise {
  if (i.rentAnnual <= 0 || i.hraAnnual <= 0) return 0;
  const rentExcess = i.rentAnnual - Math.round(i.basicAnnual * 0.1);
  const cap = Math.round(i.basicAnnual * (i.metro ? 0.5 : 0.4));
  return Math.max(0, Math.min(i.hraAnnual, rentExcess, cap));
}

/** Section 80D limit modelled here: Rs 25,000 for self and family plus Rs 25,000 for parents (below 60). */
export const SECTION_80D_CAP = 50_000_00;

export interface RegimeComparison {
  newTax: Paise;
  oldTax: Paise;
  better: Regime;
  saving: Paise;
}

/**
 * Compares the annual tax under both regimes for the same income. `annualTaxable` is the year's
 * taxable earnings before any deduction; `employeePfAnnual` and `ptAnnual` are what the old regime
 * lets you deduct. Declarations (80C/80D/HRA/other) only help in the old regime.
 */
export function compareRegimes(
  annualTaxable: Paise,
  employeePfAnnual: Paise,
  ptAnnual: Paise,
  d: Declarations,
): RegimeComparison {
  const newTax = annualTax("new", Math.max(0, annualTaxable - STANDARD_DEDUCTION.new)).total;
  const c80 = Math.min(SECTION_80C_CAP, d.section80C + employeePfAnnual);
  const oldDed =
    STANDARD_DEDUCTION.old + c80 + ptAnnual + d.section80D + d.hraExemption + d.otherDeductions;
  const oldTax = annualTax("old", Math.max(0, annualTaxable - oldDed)).total;
  const better: Regime = oldTax < newTax ? "old" : "new";
  return { newTax, oldTax, better, saving: Math.abs(newTax - oldTax) };
}
