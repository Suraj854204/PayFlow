import { csvSafe } from "@/lib/validation/hr";
import type { Paise } from "@/lib/money";
import {
  annualTax,
  SECTION_80C_CAP,
  STANDARD_DEDUCTION,
  type Declarations,
  type Regime,
} from "@/lib/payroll/tax";

export interface Line {
  code: string;
  amount: number;
}
export interface ReportItem {
  employeeId: string;
  name: string;
  code: string;
  uan: string | null;
  esiNumber: string | null;
  pan: string | null;
  state: string | null;
  paidDays: number;
  lopDays: number;
  gross: Paise;
  pfWages: Paise;
  esiWages: Paise;
  taxable: Paise;
  deductions: Line[];
  employer: Line[];
}

const amt = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount ?? 0;
const rupees = (p: Paise) => (p / 100).toFixed(2);

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return (
    [headers.map(csvSafe).join(","), ...rows.map((r) => r.map(csvSafe).join(","))].join("\r\n") +
    "\r\n"
  );
}

export function pfReport(items: ReportItem[]) {
  const rows = items
    .filter((i) => amt(i.deductions, "PF") > 0)
    .map((i) => [
      i.uan ?? "",
      i.name,
      rupees(i.gross),
      rupees(i.pfWages),
      rupees(i.pfWages),
      rupees(i.pfWages),
      rupees(amt(i.deductions, "PF")),
      rupees(amt(i.employer, "ER_EPS")),
      rupees(amt(i.employer, "ER_EPF")),
      i.lopDays,
    ]);
  const missingUan = items.filter((i) => amt(i.deductions, "PF") > 0 && !i.uan).map((i) => i.name);
  return {
    csv: toCsv(
      [
        "UAN",
        "Member name",
        "Gross wages",
        "EPF wages",
        "EPS wages",
        "EDLI wages",
        "EPF contribution (EE)",
        "EPS contribution (ER)",
        "EPF difference (ER)",
        "NCP days",
      ],
      rows,
    ),
    missing: missingUan,
  };
}

export function esiReport(items: ReportItem[]) {
  const rel = items.filter((i) => amt(i.deductions, "ESI") > 0);
  const rows = rel.map((i) => [
    i.esiNumber ?? "",
    i.name,
    i.paidDays,
    rupees(i.esiWages),
    rupees(amt(i.deductions, "ESI")),
    rupees(amt(i.employer, "ER_ESI")),
  ]);
  return {
    csv: toCsv(
      [
        "IP number",
        "Name",
        "Days worked",
        "Wages",
        "Employee contribution",
        "Employer contribution",
      ],
      rows,
    ),
    missing: rel.filter((i) => !i.esiNumber).map((i) => i.name),
  };
}

export function ptReport(items: ReportItem[]) {
  const by = new Map<string, { employees: number; total: Paise }>();
  for (const i of items) {
    const pt = amt(i.deductions, "PT");
    if (pt <= 0) continue;
    const k = i.state ?? "Unknown state";
    const cur = by.get(k) ?? { employees: 0, total: 0 };
    cur.employees += 1;
    cur.total += pt;
    by.set(k, cur);
  }
  const rows = [...by.entries()].map(([state, v]) => [state, v.employees, rupees(v.total)]);
  return {
    csv: toCsv(["State", "Employees", "Professional Tax deducted"], rows),
    missing: [] as string[],
  };
}

export function tdsReport(items: ReportItem[]) {
  const rel = items.filter((i) => amt(i.deductions, "TDS") > 0);
  const rows = rel.map((i) => [
    i.pan ?? "PANNOTAVBL",
    i.name,
    rupees(i.taxable),
    rupees(amt(i.deductions, "TDS")),
  ]);
  return {
    csv: toCsv(["PAN", "Employee", "Taxable salary paid", "TDS deducted"], rows),
    missing: rel.filter((i) => !i.pan).map((i) => i.name),
  };
}

/** What the company should deposit for the month, from the run's figures. */
export function expectedDues(items: ReportItem[]): Record<"PF" | "ESI" | "PT" | "TDS", Paise> {
  let pf = 0;
  let esi = 0;
  let pt = 0;
  let tds = 0;
  for (const i of items) {
    pf +=
      amt(i.deductions, "PF") +
      amt(i.employer, "ER_EPF") +
      amt(i.employer, "ER_EPS") +
      amt(i.employer, "ER_EDLI") +
      amt(i.employer, "ER_ADMIN");
    esi += amt(i.deductions, "ESI") + amt(i.employer, "ER_ESI");
    pt += amt(i.deductions, "PT");
    tds += amt(i.deductions, "TDS");
  }
  return { PF: pf, ESI: esi, PT: pt, TDS: tds };
}

export interface Form16Month {
  month: string;
  gross: Paise;
  taxable: Paise;
  pf: Paise;
  pt: Paise;
  tds: Paise;
}
export interface Form16Summary {
  regime: Regime;
  grossSalary: Paise;
  taxableSalary: Paise;
  standardDeduction: Paise;
  professionalTax: Paise;
  chapterVI: Paise;
  taxableIncome: Paise;
  taxOnIncome: Paise;
  tdsDeducted: Paise;
  balance: Paise;
}

/** Annual tax summary from the year's payroll. Not the signed Form 16 certificate from TRACES. */
export function form16Summary(
  months: Form16Month[],
  regime: Regime,
  d: Declarations,
): Form16Summary {
  const sum = (f: (m: Form16Month) => number) => months.reduce((s, m) => s + f(m), 0);
  const taxableSalary = sum((m) => m.taxable);
  const pf = sum((m) => m.pf);
  const pt = sum((m) => m.pt);
  const std = STANDARD_DEDUCTION[regime];
  const chapterVI =
    regime === "old"
      ? Math.min(SECTION_80C_CAP, d.section80C + pf) + d.section80D + d.otherDeductions
      : 0;
  const professionalTax = regime === "old" ? pt : 0;
  const hra = regime === "old" ? d.hraExemption : 0;
  const taxableIncome = Math.max(0, taxableSalary - std - professionalTax - chapterVI - hra);
  const taxOnIncome = annualTax(regime, taxableIncome).total;
  const tdsDeducted = sum((m) => m.tds);
  return {
    regime,
    grossSalary: sum((m) => m.gross),
    taxableSalary,
    standardDeduction: std,
    professionalTax,
    chapterVI: chapterVI + hra,
    taxableIncome,
    taxOnIncome,
    tdsDeducted,
    balance: taxOnIncome - tdsDeducted,
  };
}
