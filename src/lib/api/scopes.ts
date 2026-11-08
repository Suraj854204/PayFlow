export const API_SCOPES = [
  { id: "employees:read", label: "Read employees (no bank or ID numbers)" },
  { id: "payroll:read", label: "Read payroll runs and totals" },
  { id: "leave:read", label: "Read leave requests" },
  { id: "attendance:read", label: "Read attendance records" },
] as const;
export type ApiScope = (typeof API_SCOPES)[number]["id"];
export const API_SCOPE_IDS = API_SCOPES.map((s) => s.id) as [ApiScope, ...ApiScope[]];
