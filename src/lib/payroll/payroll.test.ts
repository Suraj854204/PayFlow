import { describe, expect, it } from "vitest";
import { rupeesToPaise as R } from "@/lib/money";
import type { BreakdownLine } from "@/lib/salary";
import { computePayItem, ZERO_INPUTS, type PayEmployee } from "./engine";
import { addMonths, daysInMonth, fyLabel, monthsLeftInFy, parseMonth } from "./period";
import { professionalTax } from "./pt";
import { computeEsi, computePf, pfCeiling } from "./statutory";
import { computeGratuity, computeSettlement, leaveEncashment, tenureBetween } from "./settlement";
import { annualTax, monthlyTds, NO_DECLARATIONS } from "./tax";

describe("period", () => {
  it("handles FY months", () => {
    expect(monthsLeftInFy("2026-04")).toBe(12);
    expect(monthsLeftInFy("2027-03")).toBe(1);
    expect(monthsLeftInFy("2026-12")).toBe(4);
    expect(fyLabel("2027-02")).toBe("2026-27");
    expect(daysInMonth("2028-02")).toBe(29);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(() => parseMonth("2026-13")).toThrow();
  });
});

describe("professional tax", () => {
  it("Karnataka", () => {
    expect(professionalTax("Karnataka", R(30000), 5, "male").tax).toBe(R(200));
    expect(professionalTax("Karnataka", R(20000), 5, "male").tax).toBe(0);
  });
  it("Maharashtra February override and gender split", () => {
    expect(professionalTax("Maharashtra", R(40000), 2, "male").tax).toBe(R(300));
    expect(professionalTax("Maharashtra", R(40000), 3, "male").tax).toBe(R(200));
    expect(professionalTax("Maharashtra", R(20000), 3, "female").tax).toBe(0);
  });
  it("Tamil Nadu is half-yearly", () => {
    expect(professionalTax("Tamil Nadu", R(50000), 5, null).tax).toBe(0);
    expect(professionalTax("Tamil Nadu", R(50000), 9, null).tax).toBeGreaterThan(0);
  });
  it("warns for unknown or missing state, none for no-PT states", () => {
    expect(professionalTax(null, R(50000), 5).warning).toBeDefined();
    expect(professionalTax("Goa", R(50000), 5).warning).toBeDefined();
    expect(professionalTax("Delhi", R(50000), 5)).toEqual({ tax: 0 });
  });
});

describe("PF and ESI", () => {
  it("caps PF at the dated ceiling", () => {
    expect(pfCeiling("2026-08")).toBe(R(15000));
    expect(pfCeiling("2026-09")).toBe(R(25000));
    expect(pfCeiling("2026-09", R(30000))).toBe(R(30000));
    const pf = computePf(R(50000), R(15000));
    expect(pf.employee).toBe(R(1800));
    expect(pf.employerEps).toBe(R(1250));
    expect(pf.employerEpf + pf.employerEps).toBe(R(1800));
  });
  it("PF below ceiling uses actual wages", () => {
    expect(computePf(R(10000), R(15000)).employee).toBe(R(1200));
  });
  it("ESI applies only up to 21,000 gross and rounds up", () => {
    expect(computeEsi(R(21001), R(21001)).applicable).toBe(false);
    const e = computeEsi(R(20000), R(20000));
    expect(e.employee).toBe(R(150));
    expect(e.employer).toBe(R(650));
    expect(computeEsi(R(18001), R(18001)).employee).toBe(R(136));
  });
});

describe("income tax", () => {
  it("new regime: zero tax up to 12L taxable (rebate)", () => {
    expect(annualTax("new", R(1200000)).total).toBe(0);
  });
  it("new regime marginal relief just above 12L", () => {
    expect(annualTax("new", R(1210000)).total).toBeLessThanOrEqual(R(10000) + R(400));
  });
  it("new regime 15L taxable", () => {
    // 0-4L 0, 4-8 20000, 8-12 40000, 12-15 45000 = 105000, +4% cess = 109200
    expect(annualTax("new", R(1500000)).total).toBe(R(109200));
  });
  it("old regime rebate and slabs", () => {
    expect(annualTax("old", R(500000)).total).toBe(0);
    // 10L: 12500 + 100000 = 112500, + cess = 117000
    expect(annualTax("old", R(1000000)).total).toBe(R(117000));
  });
  it("surcharge applies above 50L with marginal relief", () => {
    const at = annualTax("new", R(5000000)).total;
    const above = annualTax("new", R(5001000)).total;
    // Relief is computed before the 4% cess, so the cess-inclusive delta may exceed the income delta by 4%.
    expect(above - at).toBeLessThanOrEqual(R(1040));
  });
  it("monthly TDS spreads annual tax and respects YTD", () => {
    const base = {
      regime: "new" as const,
      monthsLeft: 12,
      currentTaxable: R(150000),
      currentRecurringTaxable: R(150000),
      ytdTaxable: 0,
      ytdTds: 0,
      ytdPf: 0,
      currentPf: 0,
      ytdPt: 0,
      currentPt: 0,
      declarations: NO_DECLARATIONS,
      hasPan: true,
    };
    const r = monthlyTds(base);
    expect(r.tds).toBeGreaterThan(0);
    expect(r.projectedAnnualTaxable).toBe(R(1800000));
    const prepaid = monthlyTds({ ...base, ytdTds: r.annualTax });
    expect(prepaid.tds).toBe(0);
  });
  it("no PAN deducts at least 20%", () => {
    const r = monthlyTds({
      regime: "new",
      monthsLeft: 12,
      currentTaxable: R(30000),
      currentRecurringTaxable: R(30000),
      ytdTaxable: 0,
      ytdTds: 0,
      ytdPf: 0,
      currentPf: 0,
      ytdPt: 0,
      currentPt: 0,
      declarations: NO_DECLARATIONS,
      hasPan: false,
    });
    expect(r.tds).toBe(R(6000));
  });
});

const lines: BreakdownLine[] = [
  {
    code: "BASIC",
    name: "Basic",
    type: "earning",
    monthly: R(50000),
    annual: R(600000),
    isTaxable: true,
    isPfWage: true,
  },
  {
    code: "HRA",
    name: "HRA",
    type: "earning",
    monthly: R(20000),
    annual: R(240000),
    isTaxable: true,
    isPfWage: false,
  },
  {
    code: "SPECIAL",
    name: "Special",
    type: "earning",
    monthly: R(30000),
    annual: R(360000),
    isTaxable: true,
    isPfWage: false,
  },
];
const emp = (over: Partial<PayEmployee> = {}): PayEmployee => ({
  month: "2026-05",
  gender: "male",
  workState: "Karnataka",
  regime: "new",
  hasPan: true,
  lines,
  inputs: { ...ZERO_INPUTS },
  ytd: { taxable: 0, tds: 0, pf: 0, pt: 0 },
  ...over,
});

describe("payroll engine", () => {
  it("computes a full month and balances", () => {
    const r = computePayItem(emp());
    expect(r.gross).toBe(R(100000));
    expect(r.net).toBe(r.gross - r.totalDeductions);
    expect(r.deductions.find((d) => d.code === "PF")?.amount).toBe(R(1800));
    expect(r.deductions.find((d) => d.code === "PT")?.amount).toBe(R(200));
    expect(r.paidDays).toBe(31);
  });
  it("prorates for LOP", () => {
    const r = computePayItem(emp({ inputs: { ...ZERO_INPUTS, lopDays: 3.1 - 0.1 } }));
    expect(r.gross).toBe(Math.round((R(100000) * 28) / 31));
  });
  it("rejects bad LOP", () => {
    expect(() => computePayItem(emp({ inputs: { ...ZERO_INPUTS, lopDays: 0.3 } }))).toThrow();
    expect(() => computePayItem(emp({ inputs: { ...ZERO_INPUTS, lopDays: 40 } }))).toThrow();
  });
  it("overtime, bonus, reimbursement: reimbursement is not taxable and not PF wage", () => {
    const base = computePayItem(emp());
    const r = computePayItem(
      emp({ inputs: { ...ZERO_INPUTS, reimbursement: R(5000), overtimeMinutes: 120 } }),
    );
    expect(r.earnings.find((e) => e.code === "REIMB")?.amount).toBe(R(5000));
    expect(r.deductions.find((d) => d.code === "PF")?.amount).toBe(
      base.deductions.find((d) => d.code === "PF")?.amount,
    );
    expect(r.taxableEarnings).toBeGreaterThan(base.taxableEarnings);
    const ot = r.earnings.find((e) => e.code === "OVERTIME")!.amount;
    expect(ot).toBe(Math.round((Math.round(R(50000) / 26 / 8) * 120 * 2) / 60));
  });
  it("ESI for low earners", () => {
    const low: BreakdownLine[] = [
      {
        code: "BASIC",
        name: "Basic",
        type: "earning",
        monthly: R(10000),
        annual: R(120000),
        isTaxable: true,
        isPfWage: true,
      },
      {
        code: "SPECIAL",
        name: "Special",
        type: "earning",
        monthly: R(8000),
        annual: R(96000),
        isTaxable: true,
        isPfWage: false,
      },
    ];
    const r = computePayItem(emp({ lines: low }));
    expect(r.deductions.find((d) => d.code === "ESI")?.amount).toBe(R(135));
    expect(r.employer.find((d) => d.code === "ER_ESI")?.amount).toBe(R(585));
  });
  it("flags negative net as an error", () => {
    const r = computePayItem(emp({ inputs: { ...ZERO_INPUTS, otherDeduction: R(500000) } }));
    expect(r.warnings.some((w) => w.severity === "error")).toBe(true);
  });
  it("warns when state missing", () => {
    expect(computePayItem(emp({ workState: null })).warnings.length).toBeGreaterThan(0);
  });
  it("is deterministic", () => {
    expect(computePayItem(emp())).toEqual(computePayItem(emp()));
  });
});

describe("settlement", () => {
  it("tenure", () => {
    expect(tenureBetween("2020-01-01", "2025-06-30")).toEqual({ years: 5, months: 6, days: 0 });
    expect(tenureBetween("2024-03-15", "2024-03-14")).toEqual({ years: 0, months: 0, days: 0 });
  });
  it("gratuity eligibility, rounding, cap", () => {
    expect(computeGratuity(R(50000), { years: 4, months: 11, days: 0 }).eligible).toBe(false);
    const g = computeGratuity(R(52000), { years: 5, months: 6, days: 0 });
    expect(g.yearsCounted).toBe(6);
    expect(g.amount).toBe(R((52000 / 26) * 15 * 6));
    expect(computeGratuity(R(900000), { years: 30, months: 0, days: 0 }).amount).toBe(R(2000000));
    expect(computeGratuity(R(50000), { years: 1, months: 0, days: 0 }, true).eligible).toBe(true);
  });
  it("leave encashment and settlement total", () => {
    expect(leaveEncashment(R(26000), 10)).toBe(R(10000));
    const s = computeSettlement({
      finalSalaryNet: R(40000),
      leaveEncashment: R(10000),
      gratuity: R(20000),
      noticeRecovery: R(5000),
      loanOutstanding: R(2000),
      otherRecovery: 0,
    });
    expect(s.payable).toBe(R(63000));
    expect(s.recoveries).toBe(R(7000));
  });
});
