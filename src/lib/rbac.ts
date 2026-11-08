export const ROLES = ["super_admin", "hr_admin", "finance", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  finance: "Finance",
  manager: "Manager",
  employee: "Employee",
};

export const PERMISSIONS = [
  "org:read",
  "org:manage",
  "members:read",
  "members:manage",
  "employees:read",
  "employees:read_own",
  "employees:read_team",
  "employees:write",
  "salary:read",
  "salary:write",
  "payroll:read",
  "payroll:create",
  "payroll:approve",
  "payroll:process",
  "payslips:read_own",
  "payslips:read_all",
  "attendance:read_own",
  "attendance:read_team",
  "attendance:manage",
  "leave:apply",
  "leave:approve",
  "leave:manage",
  "expenses:submit",
  "expenses:approve",
  "tax:read_own",
  "tax:manage",
  "reports:read",
  "audit:read",
  "settings:manage",
  "apikeys:manage",
  "workflows:manage",
  "ai:use",
  "ai:act",
  "announcements:manage",
  "team:cost",
  "policies:read",
  "policies:manage",
  "ewa:request",
  "ewa:manage",
  "surveys:manage",
  "recognition:give",
  "privacy:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const employee: Permission[] = [
  "org:read",
  "employees:read_own",
  "payslips:read_own",
  "attendance:read_own",
  "leave:apply",
  "expenses:submit",
  "tax:read_own",
  "ai:use",
  "policies:read",
  "ewa:request",
  "recognition:give",
];

const manager: Permission[] = [
  ...employee,
  "employees:read_team",
  "attendance:read_team",
  "leave:approve",
  "expenses:approve",
  "team:cost",
  "ai:act",
];

const finance: Permission[] = [
  ...employee,
  "employees:read",
  "salary:read",
  "payroll:read",
  "payroll:approve",
  "payroll:process",
  "payslips:read_all",
  "expenses:approve",
  "tax:manage",
  "reports:read",
  "audit:read",
  "ai:act",
  "ewa:manage",
];

const hr_admin: Permission[] = [
  ...employee,
  "members:read",
  "employees:read",
  "employees:write",
  "salary:read",
  "salary:write",
  "payroll:read",
  "payroll:create",
  "payslips:read_all",
  "attendance:read_team",
  "attendance:manage",
  "leave:approve",
  "leave:manage",
  "expenses:approve",
  "reports:read",
  "audit:read",
  "workflows:manage",
  "announcements:manage",
  "team:cost",
  "policies:manage",
  "ai:act",
  "ewa:manage",
  "surveys:manage",
  "privacy:manage",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(PERMISSIONS),
  hr_admin: new Set(hr_admin),
  finance: new Set(finance),
  manager: new Set(manager),
  employee: new Set(employee),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(permission: Permission) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

/** Maker-checker: the person who created a payroll run can never approve it. */
export function canApproveAsChecker(makerUserId: string, checkerUserId: string): boolean {
  return makerUserId !== checkerUserId;
}
