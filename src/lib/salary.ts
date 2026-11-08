import { percentOf, sum, assertPaise, type Paise } from "@/lib/money";

export type CalcType = "fixed" | "percent_of_ctc" | "percent_of_basic" | "balancing";
export type ComponentType = "earning" | "deduction";

export interface SalaryLineInput {
  code: string;
  name: string;
  type: ComponentType;
  calcType: CalcType;
  /** fixed: monthly paise. percent_*: basis points. balancing: ignored. */
  value: number;
  isTaxable: boolean;
  isPfWage: boolean;
}

export interface BreakdownLine {
  code: string;
  name: string;
  type: ComponentType;
  monthly: Paise;
  annual: Paise;
  isTaxable: boolean;
  isPfWage: boolean;
}

export interface Breakdown {
  lines: BreakdownLine[];
  ctcAnnual: Paise;
  ctcMonthly: Paise;
  grossMonthly: Paise;
  deductionsMonthly: Paise;
  /** Gross minus structure deductions, before statutory deductions computed by payroll. */
  netMonthly: Paise;
  basicMonthly: Paise;
}

export type BreakdownResult = { ok: true; breakdown: Breakdown } | { ok: false; errors: string[] };

export const BASIC_CODE = "BASIC";

/**
 * Splits an annual CTC into monthly components. CTC here is gross earnings: earnings (including the
 * single balancing component) always add up to exactly one month of CTC. Returns errors instead of
 * throwing so the UI can show every problem at once.
 */
export function computeBreakdown(ctcAnnual: Paise, input: SalaryLineInput[]): BreakdownResult {
  const errors: string[] = [];
  try {
    assertPaise(ctcAnnual);
  } catch {
    return { ok: false, errors: ["CTC must be a whole number of paise."] };
  }
  if (ctcAnnual <= 0) errors.push("CTC must be greater than zero.");

  const codes = new Set<string>();
  for (const l of input) {
    if (codes.has(l.code)) errors.push(`Component code "${l.code}" is used more than once.`);
    codes.add(l.code);
    if (!Number.isSafeInteger(l.value) || l.value < 0) {
      errors.push(`${l.name}: value must be a non-negative whole number.`);
    }
    if (l.calcType.startsWith("percent") && l.value > 10_000) {
      errors.push(`${l.name}: percentage cannot exceed 100%.`);
    }
    if (l.calcType === "balancing" && l.type !== "earning") {
      errors.push(`${l.name}: only an earning can be the balancing component.`);
    }
  }

  const balancing = input.filter((l) => l.calcType === "balancing");
  if (balancing.length > 1) errors.push("Only one component can be the balancing figure.");

  const basic = input.find((l) => l.code === BASIC_CODE);
  if (!basic) errors.push("A BASIC component is required.");
  else if (
    basic.type !== "earning" ||
    basic.calcType === "percent_of_basic" ||
    basic.calcType === "balancing"
  ) {
    errors.push("BASIC must be an earning set as a fixed amount or a percentage of CTC.");
  }
  if (errors.length > 0 || !basic) return { ok: false, errors };

  const ctcMonthly = Math.floor(ctcAnnual / 12);

  const amount = (l: SalaryLineInput, basicMonthly: Paise): Paise => {
    switch (l.calcType) {
      case "fixed":
        return l.value;
      case "percent_of_ctc":
        return percentOf(ctcMonthly, l.value);
      case "percent_of_basic":
        return percentOf(basicMonthly, l.value);
      case "balancing":
        return 0;
    }
  };

  const basicMonthly = amount(basic, 0);
  const monthlyByCode = new Map<string, Paise>();
  for (const l of input) {
    if (l.calcType !== "balancing") monthlyByCode.set(l.code, amount(l, basicMonthly));
  }

  const earningsFixed = sum(
    input
      .filter((l) => l.type === "earning" && l.calcType !== "balancing")
      .map((l) => monthlyByCode.get(l.code) ?? 0),
  );

  if (balancing.length === 1) {
    const rest = ctcMonthly - earningsFixed;
    if (rest < 0) {
      return {
        ok: false,
        errors: [
          `Earnings exceed the monthly CTC by ${(-rest / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}. Reduce a component.`,
        ],
      };
    }
    monthlyByCode.set(balancing[0].code, rest);
  } else if (earningsFixed > ctcMonthly) {
    return { ok: false, errors: ["Earnings exceed the monthly CTC. Reduce a component."] };
  }

  const lines: BreakdownLine[] = input.map((l) => {
    const monthly = monthlyByCode.get(l.code) ?? 0;
    return {
      code: l.code,
      name: l.name,
      type: l.type,
      monthly,
      annual: monthly * 12,
      isTaxable: l.isTaxable,
      isPfWage: l.isPfWage,
    };
  });

  const grossMonthly = sum(lines.filter((l) => l.type === "earning").map((l) => l.monthly));
  const deductionsMonthly = sum(lines.filter((l) => l.type === "deduction").map((l) => l.monthly));

  if (deductionsMonthly > grossMonthly) {
    return { ok: false, errors: ["Deductions exceed gross earnings."] };
  }

  return {
    ok: true,
    breakdown: {
      lines,
      ctcAnnual,
      ctcMonthly,
      grossMonthly,
      deductionsMonthly,
      netMonthly: grossMonthly - deductionsMonthly,
      basicMonthly,
    },
  };
}

/** The out-of-the-box components every new company gets. */
export const DEFAULT_COMPONENTS: (SalaryLineInput & { position: number })[] = [
  {
    code: "BASIC",
    name: "Basic",
    type: "earning",
    calcType: "percent_of_ctc",
    value: 5000,
    isTaxable: true,
    isPfWage: true,
    position: 1,
  },
  {
    code: "HRA",
    name: "House Rent Allowance",
    type: "earning",
    calcType: "percent_of_basic",
    value: 4000,
    isTaxable: true,
    isPfWage: false,
    position: 2,
  },
  {
    code: "SPECIAL",
    name: "Special Allowance",
    type: "earning",
    calcType: "balancing",
    value: 0,
    isTaxable: true,
    isPfWage: false,
    position: 3,
  },
];

export function describeCalc(l: Pick<SalaryLineInput, "calcType" | "value">): string {
  switch (l.calcType) {
    case "fixed":
      return `₹${(l.value / 100).toLocaleString("en-IN")} / month`;
    case "percent_of_ctc":
      return `${l.value / 100}% of CTC`;
    case "percent_of_basic":
      return `${l.value / 100}% of Basic`;
    case "balancing":
      return "Balancing figure";
  }
}
