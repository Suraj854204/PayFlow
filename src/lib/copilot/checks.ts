export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  id: string;
  status: CheckStatus;
  title: string;
  detail: string;
  fixHref?: string;
  fixLabel?: string;
}

export interface CopilotFacts {
  month: string;
  employeesInRun: number;
  onHold: number;
  missingBank: string[];
  missingPan: number;
  attendanceInUse: boolean;
  attendanceLocked: boolean;
  pendingLeaveInMonth: number;
  /** Approved expense claims not yet attached to any run. */
  unattachedApprovedExpenses: number;
  calcErrors: number;
  calcWarnings: number;
  anomalyHigh: number;
  anomalyMedium: number;
  overdueCompliance: number;
  zeroNet: number;
}

const names = (l: string[]) =>
  l.length <= 3 ? l.join(", ") : `${l.slice(0, 3).join(", ")} and ${l.length - 3} more`;

/** The pre-approval checklist: what to look at before a run goes to the second approver. */
export function preRunChecks(f: CopilotFacts): Check[] {
  const c: Check[] = [];
  c.push(
    f.employeesInRun > 0
      ? {
          id: "scope",
          status: "pass",
          title: `${f.employeesInRun} employees on this run`,
          detail: f.onHold ? `${f.onHold} on hold and will not be paid.` : "Nobody is on hold.",
        }
      : {
          id: "scope",
          status: "fail",
          title: "The run has no employees",
          detail: "Add employees with a salary structure, then recalculate.",
          fixHref: "/employees",
          fixLabel: "Open employees",
        },
  );
  c.push(
    f.missingBank.length === 0
      ? {
          id: "bank",
          status: "pass",
          title: "Everyone has bank details",
          detail: "Salary can be paid to every account.",
        }
      : {
          id: "bank",
          status: "fail",
          title: `${f.missingBank.length} without bank details`,
          detail: `${names(f.missingBank)} cannot be paid until an account and IFSC are added, or the item is put on hold.`,
          fixHref: "/employees",
          fixLabel: "Fix in employees",
        },
  );
  c.push(
    f.missingPan === 0
      ? {
          id: "pan",
          status: "pass",
          title: "PAN on file for everyone",
          detail: "TDS uses the normal rate.",
        }
      : {
          id: "pan",
          status: "warn",
          title: `${f.missingPan} without PAN`,
          detail: "TDS is deducted at a higher rate when PAN is missing.",
          fixHref: "/employees",
          fixLabel: "Fix in employees",
        },
  );
  if (f.attendanceInUse)
    c.push(
      f.attendanceLocked
        ? {
            id: "attendance",
            status: "pass",
            title: `Attendance for ${f.month} is locked`,
            detail: "Loss of pay and overtime come from the locked records.",
          }
        : {
            id: "attendance",
            status: "warn",
            title: `Attendance for ${f.month} is not locked`,
            detail:
              "Loss of pay and overtime are not being read from attendance. Lock the month, then recalculate.",
            fixHref: "/attendance",
            fixLabel: "Lock attendance",
          },
    );
  c.push(
    f.pendingLeaveInMonth === 0
      ? {
          id: "leave",
          status: "pass",
          title: "No leave requests are waiting",
          detail: "Approved leave is already reflected.",
        }
      : {
          id: "leave",
          status: "warn",
          title: `${f.pendingLeaveInMonth} leave requests still pending`,
          detail: "Unpaid leave that is approved later will not be in this run.",
          fixHref: "/leave",
          fixLabel: "Review leave",
        },
  );
  if (f.unattachedApprovedExpenses > 0)
    c.push({
      id: "expenses",
      status: "warn",
      title: `${f.unattachedApprovedExpenses} approved expense claims are not in this run`,
      detail: "They were approved after the run was created. Recalculate to include them.",
      fixHref: "/expenses",
      fixLabel: "See claims",
    });
  c.push(
    f.calcErrors > 0
      ? {
          id: "calc",
          status: "fail",
          title: `${f.calcErrors} items have calculation errors`,
          detail: "Open the flagged items in the table below and fix the inputs.",
        }
      : f.calcWarnings > 0
        ? {
            id: "calc",
            status: "warn",
            title: `${f.calcWarnings} items have calculation warnings`,
            detail: "These are usually safe, but read them.",
          }
        : {
            id: "calc",
            status: "pass",
            title: "No calculation warnings",
            detail: "Every item calculated cleanly.",
          },
  );
  if (f.zeroNet > 0)
    c.push({
      id: "zero",
      status: "fail",
      title: `${f.zeroNet} with zero take-home`,
      detail: "Deductions consume the whole salary. Review EMIs and manual deductions.",
    });
  c.push(
    f.anomalyHigh > 0
      ? {
          id: "anomaly",
          status: "fail",
          title: `${f.anomalyHigh} high-risk anomalies`,
          detail: "Review each one below. Dismiss with a reason if it is expected.",
        }
      : f.anomalyMedium > 0
        ? {
            id: "anomaly",
            status: "warn",
            title: `${f.anomalyMedium} anomalies to review`,
            detail: "Look at the anomaly list below before approving.",
          }
        : {
            id: "anomaly",
            status: "pass",
            title: "No anomalies detected",
            detail: "Pay changes, deductions, bank accounts and attendance look consistent.",
          },
  );
  if (f.overdueCompliance > 0)
    c.push({
      id: "compliance",
      status: "warn",
      title: `${f.overdueCompliance} compliance filings overdue`,
      detail: "Not part of this run, but late filings attract interest.",
      fixHref: "/compliance",
      fixLabel: "Open compliance",
    });
  return c;
}

export function summarizeChecks(checks: Check[]): {
  fail: number;
  warn: number;
  pass: number;
  ready: boolean;
} {
  const fail = checks.filter((c) => c.status === "fail").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  return { fail, warn, pass: checks.length - fail - warn, ready: fail === 0 };
}
