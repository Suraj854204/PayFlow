import { assertPaise, type Paise } from "@/lib/money";
import type { BreakdownLine } from "@/lib/salary";
import { daysInMonth, monthsLeftInFy, parseMonth } from "./period";
import { professionalTax } from "./pt";
import { computeEsi, computePf, pfCeiling } from "./statutory";
import { monthlyTds, NO_DECLARATIONS, type Declarations, type Regime } from "./tax";

export type Severity = "error" | "warning" | "info";
export interface PayWarning {
  severity: Severity;
  message: string;
}

export interface PayInputs {
  /** Days of loss of pay, in half-day steps. */
  lopDays: number;
  overtimeMinutes: number;
  arrears: Paise;
  bonus: Paise;
  /** Non-taxable reimbursements. */
  reimbursement: Paise;
  otherDeduction: Paise;
  loanEmi: Paise;
}
export const ZERO_INPUTS: PayInputs = {
  lopDays: 0,
  overtimeMinutes: 0,
  arrears: 0,
  bonus: 0,
  reimbursement: 0,
  otherDeduction: 0,
  loanEmi: 0,
};

export interface PayEmployee {
  month: string;
  gender?: "male" | "female" | "other" | null;
  workState?: string | null;
  regime: Regime;
  hasPan: boolean;
  /** Salary structure lines effective for the month (monthly paise, unprorated). */
  lines: BreakdownLine[];
  inputs: PayInputs;
  pfCeilingOverride?: Paise | null;
  declarations?: Declarations;
  ytd: { taxable: Paise; tds: Paise; pf: Paise; pt: Paise };
  /** Days payable in the month (e.g. for a mid-month joiner). Defaults to the whole month. */
  payableDaysOverride?: number;
}

export interface PayLine {
  code: string;
  name: string;
  amount: Paise;
}

export interface PayResult {
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  gross: Paise;
  totalDeductions: Paise;
  net: Paise;
  employerCost: Paise;
  taxableEarnings: Paise;
  paidDays: number;
  daysInMonth: number;
  warnings: PayWarning[];
  /** Wages the PF and ESI contributions were computed on (kept for statutory returns). */
  pfWages: Paise;
  esiWages: Paise;
  tds: { annualTax: Paise; projectedTaxableIncome: Paise };
}

const OT_MULTIPLIER = 2;

export function computePayItem(e: PayEmployee): PayResult {
  const parsed = parseMonth(e.month);
  const dim = daysInMonth(e.month);
  const warnings: PayWarning[] = [];
  const i = e.inputs;
  for (const [k, v] of Object.entries(i)) {
    if (k === "lopDays") continue;
    assertPaise(Math.round(v));
    if (v < 0) throw new Error(`${k} cannot be negative`);
  }

  const payable = Math.min(dim, e.payableDaysOverride ?? dim);
  if (i.lopDays < 0 || i.lopDays > payable || (i.lopDays * 2) % 1 !== 0) {
    throw new Error("LOP days must be between 0 and the payable days, in half-day steps");
  }
  const paidDays = payable - i.lopDays;
  const ratio = { num: paidDays, den: dim };
  const prorate = (amt: Paise) => Math.round((amt * ratio.num) / ratio.den);

  const earnings: PayLine[] = [];
  const deductions: PayLine[] = [];
  let taxableRecurring = 0;
  let pfWages = 0;
  let fixedGrossMonthly = 0;
  let earnedFixedGross = 0;
  let basicMonthly = 0;

  for (const l of e.lines) {
    if (l.type === "earning") {
      const earned = prorate(l.monthly);
      fixedGrossMonthly += l.monthly;
      earnedFixedGross += earned;
      if (l.code === "BASIC") basicMonthly = l.monthly;
      earnings.push({ code: l.code, name: l.name, amount: earned });
      if (l.isTaxable) taxableRecurring += earned;
      if (l.isPfWage) pfWages += earned;
    } else {
      deductions.push({ code: l.code, name: l.name, amount: l.monthly });
    }
  }

  let taxableOneOff = 0;
  if (i.overtimeMinutes > 0) {
    if (basicMonthly <= 0)
      warnings.push({ severity: "error", message: "Overtime needs a Basic component." });
    const hourly = Math.round(basicMonthly / 26 / 8);
    const ot = Math.round((hourly * i.overtimeMinutes * OT_MULTIPLIER) / 60);
    earnings.push({ code: "OVERTIME", name: "Overtime", amount: ot });
    taxableOneOff += ot;
  }
  if (i.arrears > 0) {
    earnings.push({ code: "ARREARS", name: "Arrears", amount: i.arrears });
    taxableOneOff += i.arrears;
  }
  if (i.bonus > 0) {
    earnings.push({ code: "BONUS", name: "Bonus", amount: i.bonus });
    taxableOneOff += i.bonus;
  }
  if (i.reimbursement > 0) {
    earnings.push({ code: "REIMB", name: "Reimbursement", amount: i.reimbursement });
  }

  const gross = earnings.reduce((s, l) => s + l.amount, 0);
  const taxableEarnings = taxableRecurring + taxableOneOff;

  // Statutory deductions
  const ceiling = pfCeiling(e.month, e.pfCeilingOverride);
  const pf = computePf(pfWages, ceiling);
  if (pf.employee > 0) deductions.push({ code: "PF", name: "Provident Fund", amount: pf.employee });

  const esi = computeEsi(fixedGrossMonthly, earnedFixedGross);
  if (esi.employee > 0) deductions.push({ code: "ESI", name: "ESI", amount: esi.employee });

  const ptGross = earnedFixedGross + taxableOneOff;
  const pt = professionalTax(e.workState ?? null, ptGross, parsed.month, e.gender ?? null);
  if (pt.warning) warnings.push({ severity: "warning", message: pt.warning });
  if (pt.tax > 0) deductions.push({ code: "PT", name: "Professional Tax", amount: pt.tax });

  const tds = monthlyTds({
    regime: e.regime,
    monthsLeft: monthsLeftInFy(e.month),
    currentTaxable: taxableEarnings,
    currentRecurringTaxable: taxableRecurring,
    ytdTaxable: e.ytd.taxable,
    ytdTds: e.ytd.tds,
    ytdPf: e.ytd.pf,
    currentPf: pf.employee,
    ytdPt: e.ytd.pt,
    currentPt: pt.tax,
    declarations: e.declarations ?? NO_DECLARATIONS,
    hasPan: e.hasPan,
  });
  for (const n of tds.notes) warnings.push({ severity: "warning", message: n });
  if (tds.tds > 0) deductions.push({ code: "TDS", name: "Income Tax (TDS)", amount: tds.tds });

  if (i.loanEmi > 0) deductions.push({ code: "LOAN", name: "Loan EMI", amount: i.loanEmi });
  if (i.otherDeduction > 0)
    deductions.push({ code: "OTHER", name: "Other deduction", amount: i.otherDeduction });

  const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0);
  const net = gross - totalDeductions;
  if (net < 0)
    warnings.push({
      severity: "error",
      message: "Deductions exceed earnings: net pay is negative.",
    });
  else if (gross > 0 && net === 0)
    warnings.push({ severity: "warning", message: "Net pay is zero." });

  const employer: PayLine[] = [];
  if (pf.employerEpf > 0)
    employer.push({ code: "ER_EPF", name: "Employer EPF", amount: pf.employerEpf });
  if (pf.employerEps > 0)
    employer.push({ code: "ER_EPS", name: "Employer EPS", amount: pf.employerEps });
  if (pf.edli > 0) employer.push({ code: "ER_EDLI", name: "EDLI", amount: pf.edli });
  if (pf.admin > 0)
    employer.push({ code: "ER_ADMIN", name: "EPF admin charges", amount: pf.admin });
  if (esi.employer > 0)
    employer.push({ code: "ER_ESI", name: "Employer ESI", amount: esi.employer });
  const employerCost = gross + employer.reduce((s, l) => s + l.amount, 0);

  if (paidDays === 0) warnings.push({ severity: "warning", message: "All days are loss of pay." });

  return {
    earnings,
    deductions,
    employer,
    gross,
    totalDeductions,
    net,
    employerCost,
    taxableEarnings,
    paidDays,
    daysInMonth: dim,
    warnings,
    pfWages: pf.wages,
    esiWages: esi.wages,
    tds: { annualTax: tds.annualTax, projectedTaxableIncome: tds.projectedTaxableIncome },
  };
}
