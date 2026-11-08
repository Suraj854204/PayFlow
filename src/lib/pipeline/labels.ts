export type StepName = "lock" | "draft" | "checks" | "submit" | "remind" | "payslips";
export const STEP_ORDER: StepName[] = ["lock", "draft", "checks", "submit", "remind", "payslips"];
export const STEP_LABEL: Record<StepName, string> = {
  lock: "Lock attendance",
  draft: "Create draft payroll",
  checks: "Check for problems",
  submit: "Submit for approval",
  remind: "Remind approvers",
  payslips: "Tell employees their payslip is ready",
};
