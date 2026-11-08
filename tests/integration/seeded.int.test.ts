/**
 * Runs the demo seed, then exercises the read models and services against that real data and checks
 * invariants that must hold for any payroll (not just the demo numbers).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { hashKey } from "@/lib/api/keys";
import { authenticate, isResponse } from "@/lib/api/auth";
import { openApiSpec } from "@/lib/api/openapi";
import {
  serializeAttendance,
  serializeEmployee,
  serializeLeave,
  serializeRun,
} from "@/lib/api/serialize";
import { loadAdminDashboard } from "@/lib/dashboard/load-admin";
import { loadAnnouncements, loadEmployeeDashboard } from "@/lib/dashboard/load-employee";
import { loadTeamDashboard } from "@/lib/dashboard/load-team";
import { loadReports } from "@/lib/reports/load";
import { analyzeRun } from "@/lib/anomaly/load";
import { loadReportItems } from "@/lib/compliance/load";
import { ensureCalendar, sendComplianceReminders } from "@/lib/compliance/reminders";
import { loadFacts, loadPolicy } from "@/lib/ewa/service";
import { loadMyEngagement, recentRecognitions } from "@/lib/engagement/load";
import { loadAnalytics } from "@/lib/analytics/load";
import {
  getEmployeeDetail,
  getEmployeeExtras,
  getReferenceData,
  getSalaryLibrary,
  listEmployees,
  listOrgChart,
  PAGE_SIZE,
} from "@/lib/queries";
import { assertFlagOn, loadFlags, requireFlagOn } from "@/lib/enterprise/flags-server";
import { currentMonthIst } from "@/lib/payroll/run-core";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
// Resetting a company that already has paid payroll needs the table owner (see scripts/seed.ts).
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL ?? url;
const d = describe.skipIf(!url);
const ORG = "5eed0000-0000-4000-8000-000000000001";
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

d("seeded demo company", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const inTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${ORG}, true)`);
      return fn(tx as unknown as Tx);
    });
  let empId = "";
  let mgrId = "";

  beforeAll(async () => {
    const r = spawnSync("npx", ["tsx", "scripts/seed.ts", "--reset"], {
      env: { ...process.env, DATABASE_URL: ownerUrl, NODE_OPTIONS: "--conditions=react-server" },
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    const find = async (email: string) =>
      inTenant(async (tx) => {
        const [u] = await tx
          .select({ id: schema.employees.id })
          .from(schema.employees)
          .where(eq(schema.employees.email, email));
        return u.id;
      });
    empId = await find("employee@payflow.demo");
    mgrId = await find("manager@payflow.demo");
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("payroll invariants hold for every seeded item and run", async () => {
    const { items, runs } = await inTenant(async (tx) => ({
      items: await tx.select().from(schema.payrollItems),
      runs: await tx.select().from(schema.payrollRuns),
    }));
    expect(runs).toHaveLength(6);
    expect(items.length).toBeGreaterThan(250);
    for (const i of items) {
      expect(Number.isInteger(i.net) && Number.isInteger(i.gross)).toBe(true);
      // Net is gross less deductions, after the one-off lines (loan EMI and other deductions sit in totalDeductions).
      expect(
        i.gross - i.totalDeductions + i.bonus + i.reimbursement + i.arrears,
      ).toBeGreaterThanOrEqual(0);
      expect(i.net).toBeGreaterThanOrEqual(0);
      expect(i.employerCost).toBeGreaterThanOrEqual(i.gross);
    }
    for (const r of runs) {
      const mine = items.filter((i) => i.runId === r.id && !i.onHold);
      expect(r.status).toBe("paid");
      expect(Number(r.totalNet)).toBe(mine.reduce((s, i) => s + i.net, 0));
      expect(r.employeeCount).toBe(items.filter((i) => i.runId === r.id).length);
    }
    const pay = await inTenant((tx) => tx.select().from(schema.payments));
    for (const r of runs)
      expect(pay.filter((p) => p.runId === r.id).reduce((s, p) => s + p.amount, 0)).toBe(
        Number(r.totalNet),
      );
  });

  it("admin dashboard agrees with the data", async () => {
    const a = await inTenant((tx) => loadAdminDashboard(tx, ORG, today));
    expect(a.headcount).toBe(50);
    expect(a.latestRun?.status).toBe("paid");
    expect(a.latestRun?.employees).toBe(50);
    expect(a.trend.length).toBeGreaterThanOrEqual(6);
    expect(a.departments.reduce((s, x) => s + x.share, 0)).toBeGreaterThan(0.98);
    expect(a.pending.leave).toBeGreaterThanOrEqual(4);
    expect(a.pending.expenses).toBeGreaterThanOrEqual(4);
    expect(a.insights.length).toBeGreaterThan(0);
  });

  it("employee and team dashboards", async () => {
    const e = await inTenant((tx) => loadEmployeeDashboard(tx, ORG, empId, today));
    expect(e).toBeTruthy();
    const t = await inTenant((tx) => loadTeamDashboard(tx, ORG, mgrId, today, true));
    expect(t).not.toBeNull();
    expect(await inTenant((tx) => loadTeamDashboard(tx, ORG, empId, today, false))).toBeNull();
    const ann = await inTenant((tx) => loadAnnouncements(tx, ORG, today));
    expect(ann.length).toBe(2);
  });

  it("reports, anomalies and compliance reads", async () => {
    const r = await inTenant((tx) => loadReports(tx, ORG, "2026-10"));
    expect(r.months).toHaveLength(12);
    expect(r.trend.at(-1)?.month).toBe("2026-10");
    const run = await inTenant((tx) =>
      tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, "2026-10")),
    );
    const an = await inTenant((tx) => analyzeRun(tx, ORG, run[0].id, today));
    expect(an?.month).toBe("2026-10");
    expect(an?.checks.length).toBeGreaterThan(0);
    const items = await inTenant((tx) => loadReportItems(tx, ORG, "2026-10"));
    expect(items).toHaveLength(50);
    await inTenant((tx) => ensureCalendar(tx, ORG, "2026-11"));
    const cal = await inTenant((tx) => tx.select().from(schema.complianceItems));
    expect(cal.length).toBeGreaterThan(0);
    await inTenant((tx) => sendComplianceReminders(tx, ORG, today));
  });

  it("directory queries never expose encrypted columns", async () => {
    const page1 = await inTenant((tx) => listEmployees(tx, ORG, {}));
    expect(page1.total).toBe(50);
    expect(page1.rows).toHaveLength(PAGE_SIZE);
    const found = await inTenant((tx) => listEmployees(tx, ORG, { q: "employee@payflow.demo" }));
    expect(found.total).toBe(1);
    expect(JSON.stringify(found)).not.toMatch(/panEnc|pan_enc|bankAccountEnc/);
    const dept = await inTenant((tx) => getReferenceData(tx, ORG));
    const eng = dept.departments.find((x) => x.name === "Engineering")!;
    expect(
      (await inTenant((tx) => listEmployees(tx, ORG, { departmentId: eng.id }))).total,
    ).toBeGreaterThan(5);
    const det = await inTenant((tx) => getEmployeeDetail(tx, ORG, empId));
    expect(det?.panMasked).toMatch(/\d{4}$|\*/);
    expect(JSON.stringify(det)).not.toContain("panIndex");
    const ex = await inTenant((tx) => getEmployeeExtras(tx, ORG, empId, true));
    expect(ex.salaries.length).toBeGreaterThan(0);
    expect(
      (await inTenant((tx) => getEmployeeExtras(tx, ORG, empId, false))).salaries,
    ).toHaveLength(0);
    expect((await inTenant((tx) => listOrgChart(tx, ORG))).length).toBe(50);
    expect((await inTenant((tx) => getSalaryLibrary(tx, ORG))).components.length).toBeGreaterThan(
      0,
    );
  });

  it("EWA, engagement and analytics read models", async () => {
    const pol = await inTenant((tx) => loadPolicy(tx, ORG));
    expect(pol.enabled).toBe(true);
    const facts = await inTenant((tx) => loadFacts(tx, ORG, empId, currentMonthIst(), today));
    expect(facts).not.toBeNull();
    const eng = await inTenant((tx) => loadMyEngagement(tx, ORG, empId, today));
    expect(eng.badges).toHaveLength(8);
    expect((await inTenant((tx) => recentRecognitions(tx, ORG))).length).toBeGreaterThan(0);
    const an = await inTenant((tx) => loadAnalytics(tx, ORG, today));
    expect(an.people.length).toBe(50);
  });

  it("feature flags default on, then gate", async () => {
    expect(Object.values(await inTenant((tx) => loadFlags(tx, ORG))).every(Boolean)).toBe(true);
    await inTenant((tx) =>
      tx.insert(schema.featureFlags).values({ organizationId: ORG, key: "ewa", enabled: false }),
    );
    await expect(inTenant((tx) => assertFlagOn(tx, ORG, "ewa"))).rejects.toThrow(/turned off/);
    await expect(inTenant((tx) => assertFlagOn(tx, ORG, "recognition"))).resolves.toBeUndefined();
    await expect(inTenant((tx) => requireFlagOn(tx, ORG, "ewa"))).rejects.toBeTruthy();
    await inTenant((tx) =>
      tx.delete(schema.featureFlags).where(and(eq(schema.featureFlags.organizationId, ORG))),
    );
  });

  it("public API: key checks, scopes, serialisers and spec", async () => {
    const bad = await authenticate(
      new Request("http://x/api", { headers: { authorization: "Bearer nope" } }),
      "employees:read",
    );
    expect(isResponse(bad) && bad.status).toBe(401);
    const key = `pf_live_${randomBytes(24).toString("hex")}`;
    await inTenant((tx) =>
      tx.insert(schema.apiKeys).values({
        organizationId: ORG,
        name: "t",
        prefix: key.slice(0, 12),
        keyHash: hashKey(key),
        scopes: ["employees:read"],
      }),
    );
    const req = (scope: Parameters<typeof authenticate>[1]) =>
      authenticate(
        new Request("http://x/api", { headers: { authorization: `Bearer ${key}` } }),
        scope,
      );
    const good = await req("employees:read");
    expect(isResponse(good)).toBe(false);
    if (!isResponse(good)) expect(good.orgId).toBe(ORG);
    const denied = await req("payroll:read");
    expect(isResponse(denied) && denied.status).toBe(403);

    const emp = await inTenant(
      async (tx) => (await tx.select().from(schema.employees).limit(1))[0],
    );
    const s = serializeEmployee(emp);
    expect(JSON.stringify(s)).not.toMatch(/panEnc|aadhaar|bankAccount/i);
    const run = await inTenant(
      async (tx) => (await tx.select().from(schema.payrollRuns).limit(1))[0],
    );
    expect(serializeRun(run).month).toBe(run.month);
    const lv = await inTenant(
      async (tx) => (await tx.select().from(schema.leaveRequests).limit(1))[0],
    );
    expect(serializeLeave(lv).id).toBe(lv.id);
    const at = await inTenant(
      async (tx) => (await tx.select().from(schema.attendanceRecords).limit(1))[0],
    );
    expect(serializeAttendance(at).date).toBe(at.date);
    const spec = openApiSpec("https://pf.example") as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(4);
  });
});
