const LABELS: Record<string, string> = {
  "payroll_run.created": "started a payroll run",
  "payroll_run.submitted": "sent a payroll run for approval",
  "anomaly.dismissed": "marked a payroll anomaly as expected",
  "anomaly.restored": "restored a payroll anomaly flag",
  "payroll_run.approved": "approved a payroll run",
  "payroll_run.returned": "returned a payroll run to draft",
  "payroll_run.processed": "processed a payroll run",
  "payroll_run.cancelled": "cancelled a payroll run",
  "payroll_run.recalculated": "recalculated a payroll run",
  "payroll_item.updated": "edited a payroll item",
  "employee.created": "added an employee",
  "employee.updated": "updated an employee",
  "employee.deleted": "removed an employee",
  "employee.imported": "imported employees",
  "employee.offboarding_started": "started offboarding",
  "leave.requested": "requested leave",
  "leave.cancelled": "cancelled a leave request",
  "leave.approved": "approved leave",
  "leave.rejected": "rejected leave",
  "expense.submitted": "submitted an expense claim",
  "expense.approved": "approved an expense claim",
  "expense.rejected": "rejected an expense claim",
  "attendance.month_locked": "locked attendance for a month",
  "attendance.month_unlocked": "unlocked attendance for a month",
  "attendance.corrected": "corrected an attendance record",
  "compliance.filed": "recorded a compliance filing",
  "settlement.prepared": "prepared a final settlement",
  "settlement.approved": "approved a final settlement",
  "settlement.paid": "paid a final settlement",
  "loan.created": "created a loan",
  "member.invited": "invited a team member",
  "member.joined": "joined the company",
  "announcement.posted": "posted an announcement",
  "announcement.deleted": "removed an announcement",
  "reports.exported": "exported a report",
};

/** Plain-language description of an audit action, falling back to a readable form of the code. */
export function describeAction(action: string): string {
  const known = LABELS[action];
  if (known) return known;
  const [entity, verb] = action.split(".");
  return `${(verb ?? "changed").replace(/_/g, " ")} ${(entity ?? "record").replace(/_/g, " ")}`;
}
