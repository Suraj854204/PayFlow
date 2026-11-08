import { formatINR } from "@/lib/money";
import { SECTION_80C_CAP } from "@/lib/payroll/tax";

export interface TipFacts {
  regime: "old" | "new";
  declarationStatus: "none" | "draft" | "submitted" | "verified" | "rejected";
  section80C: number;
  section80D: number;
  annualRent: number;
  employeePfAnnual: number;
  hraAnnual: number;
  /** Result of the regime comparison, when the salary is known. */
  compare: { better: "old" | "new"; saving: number } | null;
}
export interface Tip {
  id: string;
  title: string;
  detail: string;
}

/** Practical, rule-based tax-saving pointers from the employee's own declaration. */
export function taxTips(f: TipFacts): Tip[] {
  const tips: Tip[] = [];
  if (f.compare && f.compare.saving > 0 && f.compare.better !== f.regime)
    tips.push({
      id: "regime",
      title: `The ${f.compare.better} regime could save you ${formatINR(f.compare.saving)} a year`,
      detail: "Based on your current salary and declared deductions. Switch it on the tax page.",
    });
  if (f.regime === "old") {
    const used = f.section80C + f.employeePfAnnual;
    const room = Math.max(0, SECTION_80C_CAP - used);
    if (room > 0)
      tips.push({
        id: "80c",
        title: `${formatINR(room)} of Section 80C room left`,
        detail: "ELSS, PPF, tax-saver FDs, life insurance premiums and tuition fees count.",
      });
    if (f.section80D === 0)
      tips.push({
        id: "80d",
        title: "No health insurance premium declared",
        detail: "Premiums for yourself and family are deductible under 80D, up to ₹25,000.",
      });
    if (f.hraAnnual > 0 && f.annualRent === 0)
      tips.push({
        id: "hra",
        title: "You receive HRA but have declared no rent",
        detail: "If you pay rent, declare it to claim the HRA exemption.",
      });
  }
  if (f.declarationStatus === "none" || f.declarationStatus === "draft")
    tips.push({
      id: "submit",
      title: "Submit your tax declaration",
      detail: "Your TDS uses it from the next payroll run. Without one, the new regime applies.",
    });
  if (f.declarationStatus === "rejected")
    tips.push({
      id: "rejected",
      title: "Your declaration needs changes",
      detail: "HR sent it back with a note. Update it and submit again.",
    });
  return tips;
}
