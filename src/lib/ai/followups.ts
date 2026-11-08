import { can, type Role } from "@/lib/rbac";

const AFTER: Record<string, string[]> = {
  my_payslip: ["Explain my payslip in simple Hindi", "How much tax was deducted this year?"],
  my_leave_balance: ["Show my attendance this month", "How is my tax looking this year?"],
  my_tax_summary: ["Show my latest payslip", "What is my leave balance?"],
  my_attendance: ["What is my leave balance?", "Show my latest payslip"],
  company_payroll_summary: ["Check the payroll run for problems", "Show the payroll cost trend"],
  headcount_summary: ["Show attrition by department", "Show payroll cost by department"],
  pending_approvals: ["Who is on leave today?", "Which filings are due soon?"],
  team_attendance_today: ["How many approvals are waiting?"],
  compliance_due: ["Check the payroll run for problems", "Summarise this month's payroll"],
  check_payroll_run: ["Which filings are due soon?", "Show the payroll cost trend"],
  build_report: ["Show headcount trend", "Show overtime hours"],
};

/** Suggested next questions: derived from what was just answered, filtered to what this role can ask. */
export function suggestFollowUps(toolsUsed: string[], role: Role, hasEmployee: boolean): string[] {
  const out: string[] = [];
  for (const t of [...toolsUsed].reverse())
    for (const s of AFTER[t] ?? []) if (!out.includes(s)) out.push(s);
  const starters = starterPrompts(role, hasEmployee);
  for (const s of starters) if (!out.includes(s)) out.push(s);
  return out.slice(0, 3);
}

/** Conversation starters shown in an empty chat. */
export function starterPrompts(role: Role, hasEmployee: boolean): string[] {
  const s: string[] = [];
  if (hasEmployee)
    s.push(
      "What was my net pay last month?",
      "How many leaves do I have left?",
      "Any tax-saving tips for me?",
    );
  if (can(role, "payroll:read"))
    s.push("Check the payroll run for problems", "Which filings are due soon?");
  if (can(role, "reports:read")) s.push("Show attrition by department");
  if (can(role, "employees:read_team") && hasEmployee) s.push("Who on my team is on leave today?");
  return s.slice(0, 5);
}
