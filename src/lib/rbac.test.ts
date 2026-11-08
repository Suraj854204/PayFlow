import { describe, expect, it } from "vitest";
import {
  assertCan,
  can,
  canAny,
  canApproveAsChecker,
  ForbiddenError,
  isRole,
  PERMISSIONS,
  permissionsFor,
  ROLES,
} from "./rbac";

describe("rbac", () => {
  it("super admin has every permission", () => {
    for (const p of PERMISSIONS) expect(can("super_admin", p)).toBe(true);
  });

  it("employees cannot touch payroll, salaries or other people's data", () => {
    for (const p of [
      "payroll:create",
      "payroll:approve",
      "payroll:process",
      "salary:read",
      "salary:write",
      "employees:write",
      "payslips:read_all",
      "audit:read",
    ] as const) {
      expect(can("employee", p)).toBe(false);
    }
    expect(can("employee", "payslips:read_own")).toBe(true);
  });

  it("separates duties: HR creates runs, Finance approves and processes them", () => {
    expect(can("hr_admin", "payroll:create")).toBe(true);
    expect(can("hr_admin", "payroll:approve")).toBe(false);
    expect(can("hr_admin", "payroll:process")).toBe(false);
    expect(can("finance", "payroll:approve")).toBe(true);
    expect(can("finance", "payroll:process")).toBe(true);
    expect(can("finance", "payroll:create")).toBe(false);
  });

  it("managers see their team but not salaries", () => {
    expect(can("manager", "employees:read_team")).toBe(true);
    expect(can("manager", "leave:approve")).toBe(true);
    expect(can("manager", "salary:read")).toBe(false);
    expect(can("manager", "employees:read")).toBe(false);
  });

  it("only super admin manages org settings and API keys", () => {
    for (const r of ROLES.filter((r) => r !== "super_admin")) {
      expect(can(r, "org:manage")).toBe(false);
      expect(can(r, "apikeys:manage")).toBe(false);
    }
  });

  it("every role is a strict subset of super admin", () => {
    const all = new Set(permissionsFor("super_admin"));
    for (const r of ROLES) for (const p of permissionsFor(r)) expect(all.has(p)).toBe(true);
  });

  it("assertCan throws ForbiddenError with status 403", () => {
    expect(() => assertCan("employee", "payroll:create")).toThrow(ForbiddenError);
    try {
      assertCan("employee", "payroll:create");
    } catch (e) {
      expect((e as ForbiddenError).status).toBe(403);
    }
    expect(() => assertCan("finance", "payroll:approve")).not.toThrow();
  });

  it("canAny is true if any permission matches", () => {
    expect(canAny("employee", ["payroll:create", "ai:use"])).toBe(true);
    expect(canAny("employee", ["payroll:create", "audit:read"])).toBe(false);
    expect(canAny("employee", [])).toBe(false);
  });

  it("validates role strings", () => {
    expect(isRole("finance")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("maker-checker blocks self-approval", () => {
    expect(canApproveAsChecker("u1", "u1")).toBe(false);
    expect(canApproveAsChecker("u1", "u2")).toBe(true);
  });
});
