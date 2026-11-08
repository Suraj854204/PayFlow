import { type Paise } from "@/lib/money";

/**
 * State Professional Tax. This is DATA, not logic: slabs change through state budgets and
 * notifications, so every entry carries a note and the date it was last checked against sources.
 * HR must confirm against the current state notification before relying on it.
 *
 * Monthly states return the tax for one month. Half-yearly states (Tamil Nadu) deduct in set
 * months using half-year salary (monthly gross x 6).
 */
export const PT_LAST_CHECKED = "2026-10-31";

type Slab = { upTo: number; tax: number }; // rupees; upTo = highest monthly gross (inclusive), Infinity for the top slab

interface StateRule {
  kind: "monthly" | "half_yearly" | "none";
  slabs?: Slab[];
  /** Gender-specific slab sets (Maharashtra). */
  slabsByGender?: Partial<Record<"male" | "female", Slab[]>>;
  /** Months (1-12) in which half-yearly tax is deducted. */
  deductMonths?: number[];
  /** Month-specific replacement of the top slab, e.g. Maharashtra February. */
  monthOverride?: { month: number; tax: number; onlyTopSlab: true };
  note: string;
}

const INF = Number.POSITIVE_INFINITY;

export const PT_RULES: Record<string, StateRule> = {
  Karnataka: {
    kind: "monthly",
    slabs: [
      { upTo: 24_999, tax: 0 },
      { upTo: INF, tax: 200 },
    ],
    note: "Rs 200 from Rs 25,000. Some sources list a Rs 150 band for 25,001-41,999; confirm with the notification.",
  },
  Maharashtra: {
    kind: "monthly",
    slabsByGender: {
      male: [
        { upTo: 7_500, tax: 0 },
        { upTo: 10_000, tax: 175 },
        { upTo: INF, tax: 200 },
      ],
      female: [
        { upTo: 25_000, tax: 0 },
        { upTo: INF, tax: 200 },
      ],
    },
    monthOverride: { month: 2, tax: 300, onlyTopSlab: true },
    note: "Rs 300 in February on the top slab (annual Rs 2,500). Women's exemption threshold varies by source (Rs 10,000 vs Rs 25,000); Rs 25,000 used.",
  },
  Telangana: {
    kind: "monthly",
    slabs: [
      { upTo: 15_000, tax: 0 },
      { upTo: 20_000, tax: 150 },
      { upTo: INF, tax: 200 },
    ],
    note: "Standard slabs.",
  },
  "Andhra Pradesh": {
    kind: "monthly",
    slabs: [
      { upTo: 15_000, tax: 0 },
      { upTo: 20_000, tax: 150 },
      { upTo: INF, tax: 200 },
    ],
    note: "Standard slabs.",
  },
  "West Bengal": {
    kind: "monthly",
    slabs: [
      { upTo: 10_000, tax: 0 },
      { upTo: 15_000, tax: 110 },
      { upTo: 25_000, tax: 130 },
      { upTo: 40_000, tax: 150 },
      { upTo: INF, tax: 200 },
    ],
    note: "Standard slabs.",
  },
  Gujarat: {
    kind: "monthly",
    slabs: [
      { upTo: 5_999, tax: 0 },
      { upTo: 8_999, tax: 80 },
      { upTo: 11_999, tax: 150 },
      { upTo: INF, tax: 200 },
    ],
    note: "Standard slabs.",
  },
  "Madhya Pradesh": {
    kind: "monthly",
    slabs: [
      { upTo: 18_750, tax: 0 },
      { upTo: 25_000, tax: 125 },
      { upTo: 33_333, tax: 167 },
      { upTo: INF, tax: 208 },
    ],
    monthOverride: { month: 3, tax: 212, onlyTopSlab: true },
    note: "Top slab Rs 212 in March so the annual total is Rs 2,500.",
  },
  "Tamil Nadu": {
    kind: "half_yearly",
    // Half-yearly salary bands (monthly gross x 6).
    slabs: [
      { upTo: 21_000, tax: 0 },
      { upTo: 30_000, tax: 135 },
      { upTo: 45_000, tax: 315 },
      { upTo: 60_000, tax: 690 },
      { upTo: 75_000, tax: 1_025 },
      { upTo: INF, tax: 1_250 },
    ],
    deductMonths: [9, 3],
    note: "Half-yearly, deducted in September and March on half-year salary.",
  },
};

/** States with no Professional Tax. Any state in neither list is reported as "not configured". */
const TRULY_NONE = new Set([
  "Delhi",
  "Uttar Pradesh",
  "Haryana",
  "Rajasthan",
  "Uttarakhand",
  "Himachal Pradesh",
  "Jammu and Kashmir",
]);

export type PtResult = { tax: Paise; warning?: string };

function pickSlab(slabs: Slab[], rupees: number): { slab: Slab; top: boolean } {
  const idx = slabs.findIndex((s) => rupees <= s.upTo);
  const i = idx === -1 ? slabs.length - 1 : idx;
  return { slab: slabs[i], top: i === slabs.length - 1 };
}

/**
 * @param grossMonthly earned gross for the month, in paise (excluding reimbursements)
 * @param calendarMonth 1-12
 */
export function professionalTax(
  state: string | null | undefined,
  grossMonthly: Paise,
  calendarMonth: number,
  gender?: "male" | "female" | "other" | null,
): PtResult {
  if (!state)
    return { tax: 0, warning: "Work state is not set, so Professional Tax was not deducted." };
  if (TRULY_NONE.has(state)) return { tax: 0 };
  const rule = PT_RULES[state];
  if (!rule) {
    return {
      tax: 0,
      warning: `Professional Tax is not configured for ${state}. Verify whether it applies.`,
    };
  }
  const rupees = Math.floor(grossMonthly / 100);

  if (rule.kind === "half_yearly") {
    if (!rule.deductMonths?.includes(calendarMonth)) return { tax: 0 };
    const { slab } = pickSlab(rule.slabs!, rupees * 6);
    return { tax: slab.tax * 100 };
  }

  const slabs = rule.slabsByGender
    ? (rule.slabsByGender[gender === "female" ? "female" : "male"] ?? rule.slabsByGender.male!)
    : rule.slabs!;
  const { slab, top } = pickSlab(slabs, rupees);
  let tax = slab.tax;
  if (rule.monthOverride && top && slab.tax > 0 && rule.monthOverride.month === calendarMonth) {
    tax = rule.monthOverride.tax;
  }
  return { tax: tax * 100 };
}

export const PT_SUPPORTED_STATES = [...Object.keys(PT_RULES), ...TRULY_NONE].sort();
