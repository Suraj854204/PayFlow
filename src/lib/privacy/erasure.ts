/**
 * What an erasure request does, and what it cannot. Payroll, tax and statutory records must be kept
 * for years (for example PF/ESI/TDS records and the audit trail), so the person's identifying details
 * are removed while the numbers stay. The request is reviewed by HR, not applied automatically.
 */
export const RETAINED_RECORDS = [
  "Payroll runs, payslip amounts and tax deductions (statutory retention)",
  "The audit log (it records that actions happened, not personal details)",
  "Leave, attendance and expense totals used in company reports",
] as const;

export const ERASED_FIELDS = [
  "Name, email, phone, date of birth",
  "PAN, Aadhaar, UAN, ESI number, bank account, IFSC and bank name",
  "Uploaded documents and expense receipt images",
] as const;

export const ERASED_NAME = "Erased employee";

/** Placeholder email that still satisfies the unique index and cannot receive mail. */
export const erasedEmail = (employeeId: string) => `erased+${employeeId}@invalid.payflow`;
