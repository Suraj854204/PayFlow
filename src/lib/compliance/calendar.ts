import { addMonths } from "@/lib/payroll/period";

export type ComplianceKind = "PF" | "ESI" | "PT" | "TDS" | "TDS_RETURN";

export const KIND_LABEL: Record<ComplianceKind, string> = {
  PF: "Provident Fund (ECR and challan)",
  ESI: "ESI contribution",
  PT: "Professional Tax",
  TDS: "TDS deposit (challan 281)",
  TDS_RETURN: "TDS return (Form 24Q)",
};

/**
 * Statutory due date for an obligation that relates to `period` (YYYY-MM).
 * PF and ESI: 15th of the next month. TDS deposit: 7th of the next month, 30 April for March.
 * Professional Tax due dates differ by state; the 15th of the next month is used as a safe default.
 * Form 24Q: 31 Jul, 31 Oct, 31 Jan and 31 May after each quarter (the period is the quarter's last month).
 */
export function dueDate(kind: ComplianceKind, period: string): string {
  const next = addMonths(period, 1);
  const [y, m] = period.split("-").map(Number);
  switch (kind) {
    case "PF":
    case "ESI":
    case "PT":
      return `${next}-15`;
    case "TDS":
      return m === 3 ? `${y}-04-30` : `${next}-07`;
    case "TDS_RETURN": {
      if (![6, 9, 12, 3].includes(m)) throw new Error("24Q periods end in Jun, Sep, Dec or Mar");
      const due: Record<number, string> = {
        6: `${y}-07-31`,
        9: `${y}-10-31`,
        12: `${y + 1}-01-31`,
        3: `${y}-05-31`,
      };
      return due[m];
    }
  }
}

export interface PlannedItem {
  kind: ComplianceKind;
  period: string;
  dueDate: string;
}

/** The obligations for `count` months starting at `fromMonth`, plus quarterly returns that fall in range. */
export function planCalendar(fromMonth: string, count: number): PlannedItem[] {
  const out: PlannedItem[] = [];
  for (let i = 0; i < count; i++) {
    const period = addMonths(fromMonth, i);
    for (const kind of ["PF", "ESI", "PT", "TDS"] as const)
      out.push({ kind, period, dueDate: dueDate(kind, period) });
    if ([6, 9, 12, 3].includes(Number(period.slice(5))))
      out.push({ kind: "TDS_RETURN", period, dueDate: dueDate("TDS_RETURN", period) });
  }
  return out;
}

export type DueState = "filed" | "overdue" | "due_soon" | "upcoming";

export function dueState(
  item: { status: string; dueDate: string },
  today: string,
  soonDays = 7,
): DueState {
  if (item.status === "filed") return "filed";
  if (item.dueDate < today) return "overdue";
  const diff =
    (Date.parse(`${item.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return diff <= soonDays ? "due_soon" : "upcoming";
}
