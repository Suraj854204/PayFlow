import { formatINRCompact } from "@/lib/money";

export type InsightTone = "danger" | "warning" | "info" | "success";
export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  href?: string;
}

export interface InsightFacts {
  pendingPayrollApprovals: number;
  pendingLeave: number;
  pendingExpenses: number;
  pendingDeclarations: number;
  missingBank: number;
  missingPan: number;
  overdueCompliance: number;
  dueSoonCompliance: number;
  /** Employer cost change, latest month vs the one before, as a percentage. */
  costChangePct: number | null;
  latestCost: number | null;
  /** Previous month has no attendance lock though today is past its end. */
  attendanceUnlockedMonth: string | null;
  probationEnding: number;
  daysToCutoff: number;
  currentMonthRun: "none" | "draft" | "review" | "approved" | "processing" | "paid";
}

const RANK: Record<InsightTone, number> = { danger: 0, warning: 1, info: 2, success: 3 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Rule-based observations for the admin dashboard. These are deterministic checks over the
 * company's own data, not model output; AI-written insights arrive with PayBot.
 */
export function buildInsights(f: InsightFacts): Insight[] {
  const out: Insight[] = [];
  if (f.overdueCompliance > 0)
    out.push({
      id: "compliance-overdue",
      tone: "danger",
      title: `${plural(f.overdueCompliance, "compliance filing")} overdue`,
      detail: "Late PF, ESI, PT or TDS payments attract interest and penalties.",
      href: "/compliance",
    });
  if (f.missingBank > 0)
    out.push({
      id: "missing-bank",
      tone: "danger",
      title: `${plural(f.missingBank, "employee")} without bank details`,
      detail: "Their salary cannot be paid until an account and IFSC are on file.",
      href: "/employees",
    });
  if (f.attendanceUnlockedMonth)
    out.push({
      id: "attendance-unlocked",
      tone: "warning",
      title: `Lock attendance for ${f.attendanceUnlockedMonth}`,
      detail: "Payroll reads loss of pay and overtime only from locked months.",
      href: "/attendance",
    });
  if (f.currentMonthRun === "none" && f.daysToCutoff <= 5)
    out.push({
      id: "run-not-started",
      tone: "warning",
      title: "Payroll for this month has not been started",
      detail: `The attendance cutoff is in ${plural(f.daysToCutoff, "day")}.`,
      href: "/payroll",
    });
  if (f.pendingPayrollApprovals > 0)
    out.push({
      id: "payroll-approval",
      tone: "warning",
      title: `${plural(f.pendingPayrollApprovals, "payroll run")} waiting for approval`,
      detail: "A second person must approve before the run can be processed.",
      href: "/payroll",
    });
  if (f.dueSoonCompliance > 0)
    out.push({
      id: "compliance-soon",
      tone: "warning",
      title: `${plural(f.dueSoonCompliance, "filing")} due within 7 days`,
      detail: "Download the report and record the challan once paid.",
      href: "/compliance",
    });
  const queues = f.pendingLeave + f.pendingExpenses + f.pendingDeclarations;
  if (queues > 0)
    out.push({
      id: "queues",
      tone: "info",
      title: `${plural(queues, "request")} waiting for a decision`,
      detail: [
        f.pendingLeave ? plural(f.pendingLeave, "leave request") : "",
        f.pendingExpenses ? plural(f.pendingExpenses, "expense claim") : "",
        f.pendingDeclarations ? plural(f.pendingDeclarations, "tax declaration") : "",
      ]
        .filter(Boolean)
        .join(", "),
      href: f.pendingLeave ? "/leave" : f.pendingExpenses ? "/expenses" : "/tax",
    });
  if (f.missingPan > 0)
    out.push({
      id: "missing-pan",
      tone: "info",
      title: `${plural(f.missingPan, "employee")} without PAN`,
      detail: "TDS is deducted at a higher rate when PAN is missing.",
      href: "/employees",
    });
  if (f.probationEnding > 0)
    out.push({
      id: "probation",
      tone: "info",
      title: `${plural(f.probationEnding, "probation")} ending in 30 days`,
      detail: "Confirm or extend before the end date.",
      href: "/employees",
    });
  if (f.costChangePct !== null && Math.abs(f.costChangePct) >= 5 && f.latestCost !== null)
    out.push({
      id: "cost-change",
      tone: "info",
      title: `Payroll cost ${f.costChangePct > 0 ? "rose" : "fell"} ${Math.abs(f.costChangePct)}% month on month`,
      detail: `Latest employer cost is ${formatINRCompact(f.latestCost)}. Check joiners, leavers and arrears.`,
      href: "/reports",
    });
  if (out.length === 0)
    out.push({
      id: "all-clear",
      tone: "success",
      title: "Nothing needs your attention",
      detail: "No pending approvals, missing details or overdue filings.",
    });
  return out.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}
