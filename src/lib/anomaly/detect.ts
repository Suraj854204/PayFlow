import { formatINR } from "@/lib/money";

export type Severity = "high" | "medium" | "low";
export type AnomalyKind =
  "salary_spike" | "duplicate_account" | "abnormal_deduction" | "ghost_employee";

export interface Anomaly {
  /** Stable per run, so a dismissal survives recalculation. */
  key: string;
  kind: AnomalyKind;
  severity: Severity;
  employeeIds: string[];
  title: string;
  explanation: string;
  suggestion: string;
}

export interface RunItemFacts {
  employeeId: string;
  name: string;
  gross: number;
  net: number;
  totalDeductions: number;
  tds: number;
  otherDeduction: number;
  /** Bonus, arrears, overtime and reimbursements: pay that is expected to vary month to month. */
  oneOffs: number;
  lopDays: number;
  onHold: boolean;
  /** One-way fingerprint of the bank account, used only to compare in memory. Never displayed. */
  accountFingerprint: string | null;
  joinDate: string;
  exitDate: string | null;
  /** Days with a present, half-day or leave record in the month. */
  attendanceDays: number;
}
export interface PreviousFacts {
  net: number;
  gross: number;
  tds: number;
}

export const THRESHOLDS = {
  spikePct: 25,
  spikeMinPaise: 5_000_00,
  deductionRatio: 0.45,
  otherDeductionRatio: 0.2,
  tdsMultiple: 2,
  tdsMinPaise: 5_000_00,
} as const;

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);

/**
 * Deterministic checks over one payroll run. Each finding carries a plain-language explanation with
 * the actual numbers and a concrete next step, so a reviewer can act without digging.
 */
export function detectAnomalies(
  month: string,
  items: RunItemFacts[],
  previous: Map<string, PreviousFacts>,
  opts: { attendanceInUse: boolean },
): Anomaly[] {
  const out: Anomaly[] = [];
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const live = items.filter((i) => !i.onHold);

  for (const i of live) {
    const prev = previous.get(i.employeeId);

    // 1. Pay jumped or dropped without a one-off to explain it.
    if (prev && prev.net > 0) {
      const underlying = i.net - i.oneOffs;
      const change = pct(underlying, prev.net);
      const diff = Math.abs(underlying - prev.net);
      const dropExplainedByLop = underlying < prev.net && i.lopDays > 0;
      if (
        Math.abs(change) >= THRESHOLDS.spikePct &&
        diff >= THRESHOLDS.spikeMinPaise &&
        !dropExplainedByLop
      )
        out.push({
          key: `salary_spike:${i.employeeId}`,
          kind: "salary_spike",
          severity: Math.abs(change) >= 50 ? "high" : "medium",
          employeeIds: [i.employeeId],
          title: `${i.name}'s pay ${change > 0 ? "jumped" : "dropped"} ${Math.abs(change)}%`,
          explanation: `Net pay excluding bonus, arrears, overtime and reimbursements is ${formatINR(underlying)}, against ${formatINR(prev.net)} last month. No one-off item or loss of pay accounts for the difference.`,
          suggestion:
            "Check whether a salary revision, joining or exit date, or a data-entry mistake explains it before approving.",
        });
    }

    // 2. Deductions that look wrong in size.
    if (i.gross > 0) {
      const ratio = i.totalDeductions / i.gross;
      if (ratio >= THRESHOLDS.deductionRatio)
        out.push({
          key: `abnormal_deduction:${i.employeeId}`,
          kind: "abnormal_deduction",
          severity: ratio >= 0.6 ? "high" : "medium",
          employeeIds: [i.employeeId],
          title: `${i.name} loses ${Math.round(ratio * 100)}% of gross to deductions`,
          explanation: `Deductions are ${formatINR(i.totalDeductions)} on gross pay of ${formatINR(i.gross)}. Most months this should be well under half.`,
          suggestion:
            "Open the item and review loan EMIs, other deductions and TDS for an entry that does not belong.",
        });
      else if (i.otherDeduction / i.gross >= THRESHOLDS.otherDeductionRatio)
        out.push({
          key: `abnormal_deduction:${i.employeeId}`,
          kind: "abnormal_deduction",
          severity: "medium",
          employeeIds: [i.employeeId],
          title: `${i.name} has a large manual deduction`,
          explanation: `A manual deduction of ${formatINR(i.otherDeduction)} is ${Math.round((i.otherDeduction / i.gross) * 100)}% of gross pay (${formatINR(i.gross)}).`,
          suggestion: "Confirm the amount and the reason with the employee or their manager.",
        });
    }
    if (
      prev &&
      prev.tds > 0 &&
      i.tds >= prev.tds * THRESHOLDS.tdsMultiple &&
      i.tds - prev.tds >= THRESHOLDS.tdsMinPaise
    )
      out.push({
        key: `abnormal_deduction:tds:${i.employeeId}`,
        kind: "abnormal_deduction",
        severity: "low",
        employeeIds: [i.employeeId],
        title: `${i.name}'s TDS more than doubled`,
        explanation: `TDS is ${formatINR(i.tds)} against ${formatINR(prev.tds)} last month.`,
        suggestion:
          "This is expected after a bonus or a declaration change. If neither happened, review the tax regime and declaration.",
      });
    if (i.net <= 0)
      out.push({
        key: `abnormal_deduction:net:${i.employeeId}`,
        kind: "abnormal_deduction",
        severity: "high",
        employeeIds: [i.employeeId],
        title: `${i.name} has no take-home pay`,
        explanation: `Deductions of ${formatINR(i.totalDeductions)} consume the whole gross pay of ${formatINR(i.gross)}.`,
        suggestion: "Reduce the loan EMI or manual deduction, or put the item on hold.",
      });

    // 3. People who should not be on this run.
    if (i.exitDate && i.exitDate < monthStart)
      out.push({
        key: `ghost_employee:exited:${i.employeeId}`,
        kind: "ghost_employee",
        severity: "high",
        employeeIds: [i.employeeId],
        title: `${i.name} left before this month but is being paid`,
        explanation: `Their exit date is ${i.exitDate}, before ${monthStart}. They are still on the run with net pay of ${formatINR(i.net)}.`,
        suggestion:
          "Put the item on hold or remove it, and process any dues through a final settlement.",
      });
    if (i.joinDate > monthEnd)
      out.push({
        key: `ghost_employee:future:${i.employeeId}`,
        kind: "ghost_employee",
        severity: "high",
        employeeIds: [i.employeeId],
        title: `${i.name} has not joined yet but is on the run`,
        explanation: `Their joining date is ${i.joinDate}, after this month.`,
        suggestion: "Check the joining date, then hold or remove the item.",
      });
    if (
      opts.attendanceInUse &&
      i.attendanceDays === 0 &&
      i.lopDays === 0 &&
      i.net > 0 &&
      !(i.exitDate && i.exitDate < monthStart)
    )
      out.push({
        key: `ghost_employee:no_attendance:${i.employeeId}`,
        kind: "ghost_employee",
        severity: "medium",
        employeeIds: [i.employeeId],
        title: `${i.name} has no attendance or leave this month`,
        explanation: `Everyone else has attendance recorded, but ${i.name} has none and is paid in full (${formatINR(i.net)}).`,
        suggestion: "Confirm they actually worked, or record leave or loss of pay.",
      });
  }

  // 4. One bank account receiving more than one person's salary.
  const byAccount = new Map<string, RunItemFacts[]>();
  for (const i of live) {
    if (!i.accountFingerprint) continue;
    byAccount.set(i.accountFingerprint, [...(byAccount.get(i.accountFingerprint) ?? []), i]);
  }
  for (const [fp, group] of byAccount)
    if (group.length > 1) {
      const names = group.map((g) => g.name).join(" and ");
      out.push({
        key: `duplicate_account:${fp.slice(0, 12)}`,
        kind: "duplicate_account",
        severity: "high",
        employeeIds: group.map((g) => g.employeeId),
        title: `${group.length} employees share one bank account`,
        explanation: `${names} are set to be paid into the same account. That is how duplicate or fake payees usually show up.`,
        suggestion:
          "Verify each person's bank proof. Joint family accounts can be legitimate; if so, dismiss this with a note.",
      });
    }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}
