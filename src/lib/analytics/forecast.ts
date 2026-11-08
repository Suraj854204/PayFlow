import { addMonths } from "@/lib/payroll/period";
import type { Paise } from "@/lib/money";

export interface HirePlan {
  /** Month the new people start, YYYY-MM. */
  month: string;
  count: number;
  /** Average annual CTC of each hire. */
  ctcAnnual: Paise;
}

export interface ForecastInput {
  /** The month to project from (the last month with real payroll). */
  fromMonth: string;
  /** What the company really paid last month: total employer cost. */
  baselineMonthlyCost: Paise;
  headcount: number;
  /** Fraction of headcount expected to leave each month, e.g. 0.01. */
  monthlyAttritionRate: number;
  /** Average monthly employer cost of someone who leaves. Defaults to baseline / headcount. */
  avgCostPerHead?: Paise;
  /** Replace leavers one month after they go. */
  backfill: boolean;
  hires: HirePlan[];
  /** Yearly increment applied from `incrementMonth`, as a fraction (0.08 = 8%). */
  incrementRate: number;
  incrementMonth?: string;
  /** Extra employer cost on top of CTC for new hires (PF, ESI, etc.), as a fraction. */
  onCostRate?: number;
}

export interface ForecastMonth {
  month: string;
  headcount: number;
  cost: Paise;
  /** Change from the month before. */
  deltaFromPrevious: Paise;
  parts: {
    existing: Paise;
    hires: Paise;
    increments: Paise;
    attritionSaving: Paise;
    backfill: Paise;
  };
}

export const FORECAST_MONTHS = 6;

/**
 * A simple, explainable projection: start from what was really paid, then add the plan. Every
 * number on a row comes from a named part so the reader can see why the total moved.
 */
export function forecastCost(i: ForecastInput): ForecastMonth[] {
  const perHead =
    i.avgCostPerHead ?? (i.headcount > 0 ? Math.round(i.baselineMonthlyCost / i.headcount) : 0);
  const onCost = 1 + (i.onCostRate ?? 0.13);
  let heads = i.headcount;
  let leavers: number[] = [];
  let prev = i.baselineMonthlyCost;
  const out: ForecastMonth[] = [];
  let hiredCost = 0;
  let backfillCost = 0;
  let savedByAttrition = 0;
  let incrementFactor = 1;

  for (let k = 1; k <= FORECAST_MONTHS; k++) {
    const month = addMonths(i.fromMonth, k);
    const gone = Math.round(heads * i.monthlyAttritionRate * 100) / 100;
    leavers.push(gone);
    heads -= gone;
    savedByAttrition += Math.round(gone * perHead);

    if (i.backfill && k > 1) {
      const back = leavers[k - 2];
      heads += back;
      backfillCost += Math.round(back * perHead);
      savedByAttrition -= Math.round(back * perHead);
    }
    for (const h of i.hires.filter((x) => x.month === month)) {
      heads += h.count;
      hiredCost += Math.round(h.count * (h.ctcAnnual / 12) * onCost);
    }
    if (i.incrementMonth && month >= i.incrementMonth && incrementFactor === 1)
      incrementFactor = 1 + i.incrementRate;
    const existing = i.baselineMonthlyCost;
    const incrementCost = Math.round((existing - savedByAttrition) * (incrementFactor - 1));
    const cost = Math.round(existing - savedByAttrition + hiredCost + incrementCost);
    out.push({
      month,
      headcount: Math.round(heads * 10) / 10,
      cost,
      deltaFromPrevious: cost - prev,
      parts: {
        existing,
        hires: hiredCost,
        increments: incrementCost,
        attritionSaving: savedByAttrition,
        backfill: backfillCost,
      },
    });
    prev = cost;
  }
  leavers = [];
  return out;
}

export function totalForecast(rows: ForecastMonth[]): Paise {
  return rows.reduce((s, r) => s + r.cost, 0);
}
