import { computeBreakdown, DEFAULT_COMPONENTS, type SalaryLineInput } from "@/lib/salary";
import { computePayItem, ZERO_INPUTS } from "@/lib/payroll/engine";
import { addMonths, fyFirstMonth } from "@/lib/payroll/period";
import { NO_DECLARATIONS, type Declarations, type Regime } from "@/lib/payroll/tax";
import type { Paise } from "@/lib/money";

export interface SimInput {
  ctcAnnual: Paise;
  /** Any month of the financial year to simulate, YYYY-MM. */
  month: string;
  workState?: string | null;
  gender?: "male" | "female" | "other" | null;
  declarations?: Declarations;
  /** The company's salary components; defaults to the built-in structure. */
  components?: SalaryLineInput[];
}

export interface RegimeOutcome {
  regime: Regime;
  /** Typical monthly take-home (the median month, so one-off effects do not skew it). */
  monthlyTakeHome: Paise;
  annualTakeHome: Paise;
  annualTax: Paise;
  annualPf: Paise;
  annualPt: Paise;
  monthly: { month: string; net: Paise; tds: Paise }[];
}

export type SimResult =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      ctcAnnual: Paise;
      grossMonthly: Paise;
      new: RegimeOutcome;
      old: RegimeOutcome;
      better: Regime;
      /** Extra annual take-home from choosing the better regime. */
      annualAdvantage: Paise;
    };

const sumOf = (lines: { code: string; amount: number }[], code: string) =>
  lines.find((l) => l.code === code)?.amount ?? 0;

/**
 * Runs the real payroll engine for all 12 months of the financial year, carrying year-to-date
 * figures forward exactly like a live payroll, once per tax regime. So the simulator can never
 * disagree with what payroll would actually do.
 */
export function simulate(input: SimInput): SimResult {
  const components = input.components ?? DEFAULT_COMPONENTS;
  const bd = computeBreakdown(input.ctcAnnual, components);
  if (!bd.ok) return { ok: false, errors: bd.errors };
  const first = fyFirstMonth(input.month);

  const run = (regime: Regime): RegimeOutcome => {
    const ytd = { taxable: 0, tds: 0, pf: 0, pt: 0 };
    const monthly: RegimeOutcome["monthly"] = [];
    let annualTake = 0;
    let tax = 0;
    let pf = 0;
    let pt = 0;
    for (let i = 0; i < 12; i++) {
      const month = addMonths(first, i);
      const r = computePayItem({
        month,
        gender: input.gender ?? null,
        workState: input.workState ?? null,
        regime,
        hasPan: true,
        lines: bd.breakdown.lines,
        inputs: ZERO_INPUTS,
        declarations: input.declarations ?? NO_DECLARATIONS,
        ytd: { ...ytd },
      });
      const tds = sumOf(r.deductions, "TDS");
      const mpf = sumOf(r.deductions, "PF");
      const mpt = sumOf(r.deductions, "PT");
      ytd.taxable += r.taxableEarnings;
      ytd.tds += tds;
      ytd.pf += mpf;
      ytd.pt += mpt;
      annualTake += r.net;
      tax += tds;
      pf += mpf;
      pt += mpt;
      monthly.push({ month, net: r.net, tds });
    }
    const sorted = monthly.map((m) => m.net).sort((a, b) => a - b);
    return {
      regime,
      monthlyTakeHome: sorted[Math.floor(sorted.length / 2)],
      annualTakeHome: annualTake,
      annualTax: tax,
      annualPf: pf,
      annualPt: pt,
      monthly,
    };
  };

  const n = run("new");
  const o = run("old");
  const better: Regime = o.annualTakeHome > n.annualTakeHome ? "old" : "new";
  return {
    ok: true,
    ctcAnnual: input.ctcAnnual,
    grossMonthly: bd.breakdown.grossMonthly,
    new: n,
    old: o,
    better,
    annualAdvantage: Math.abs(o.annualTakeHome - n.annualTakeHome),
  };
}

export interface Comparison {
  current: Extract<SimResult, { ok: true }>;
  proposed: Extract<SimResult, { ok: true }>;
  /** Change in monthly take-home under each regime (proposed minus current). */
  takeHomeDelta: { new: Paise; old: Paise };
  /** Share of each extra rupee of CTC that reaches the employee, in basis points (new regime). */
  marginalKeepBp: number | null;
}

export function compareCtc(
  current: SimInput,
  proposedCtc: Paise,
): { ok: false; errors: string[] } | ({ ok: true } & Comparison) {
  const a = simulate(current);
  if (!a.ok) return a;
  const b = simulate({ ...current, ctcAnnual: proposedCtc });
  if (!b.ok) return b;
  const dCtc = proposedCtc - current.ctcAnnual;
  return {
    ok: true,
    current: a,
    proposed: b,
    takeHomeDelta: {
      new: b.new.monthlyTakeHome - a.new.monthlyTakeHome,
      old: b.old.monthlyTakeHome - a.old.monthlyTakeHome,
    },
    marginalKeepBp:
      dCtc === 0
        ? null
        : Math.round(((b.new.annualTakeHome - a.new.annualTakeHome) * 10000) / dCtc),
  };
}
