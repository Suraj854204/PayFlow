/** Money paths on a fresh company, built with the same functions the app uses. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { withTenant, type Tx } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { seedSalaryDefaults } from "@/lib/org-defaults";
import { assignSalaryTx } from "@/lib/workforce/assign-salary";
import {
  ensureBalances,
  fyStartOf,
  prorateQuota,
  seedLeaveDefaults,
} from "@/lib/workforce/leave-balance";
import { lockMonthTx } from "@/lib/workforce/lock-month";
import { createRunTx, currentMonthIst, submitRunTx } from "@/lib/payroll/run-core";
import { addMonths } from "@/lib/payroll/period";
import { dispatchRunPayments, settleRunIfComplete } from "@/lib/payments/dispatch";
import { getProvider, simulatedProvider } from "@/lib/payments/provider";
import { advancePipeline, raiseDeadlineEvents } from "@/lib/pipeline/sweep";
import { STEP_ORDER } from "@/lib/pipeline/labels";
import type { ActionHelpers } from "@/lib/action-runner";
import type { AppContext } from "@/lib/auth/context";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = describe.skipIf(!url);

d("payroll, payments, attendance lock and leave balances", () => {
  const org = randomUUID();
  const hrUser = `hr-${randomUUID()}`;
  const checker = `chk-${randomUUID()}`;
  let pool: Pool;
  let structureId = "";
  const emp: Record<string, string> = {};
  const month = addMonths(currentMonthIst(), -1);
  const helpers = (tx: Tx): ActionHelpers => {
    const ctx: AppContext = {
      user: { id: hrUser, name: "HR", email: "", image: null, twoFactorEnabled: false },
      organizationId: org,
      role: "hr_admin",
      membershipId: "",
      employeeId: null,
      companies: [],
    };
    return { ctx, tx, audit: async () => undefined };
  };
  const run = <T>(fn: (h: ActionHelpers) => Promise<T>) => withTenant(org, (tx) => fn(helpers(tx)));
  const mk = (code: string, over: Partial<typeof schema.employees.$inferInsert> = {}) =>
    withTenant(org, async (tx) => {
      const [e] = await tx
        .insert(schema.employees)
        .values({
          organizationId: org,
          employeeCode: code,
          firstName: code,
          lastName: "Svc",
          email: `${code.toLowerCase()}-${org.slice(0, 6)}@x.in`,
          joinDate: "2024-04-01",
          bankAccountEnc: encrypt("123456789012"),
          bankIfsc: "HDFC0001234",
          bankName: "HDFC",
          workState: "Karnataka",
          ...over,
        })
        .returning({ id: schema.employees.id });
      return e.id;
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(
      `insert into "user"(id,name,email,email_verified) values ($1,'HR',$2,true),($3,'Chk',$4,true)`,
      [hrUser, `${hrUser}@x.in`, checker, `${checker}@x.in`],
    );
    await withTenant(org, async (tx) => {
      await tx
        .insert(schema.organizations)
        .values({ id: org, name: "Svc Co", slug: `svc-${org.slice(0, 8)}`, state: "Karnataka" });
      await seedSalaryDefaults(tx, org);
      await seedLeaveDefaults(tx, org);
      structureId = (await tx.select().from(schema.salaryStructures))[0].id;
    });
    emp.a = await mk("A1");
    emp.b = await mk("B1");
    emp.nosal = await mk("N1");
    emp.badBank = await mk("X1", { bankIfsc: "BADIFSC" });
  });

  afterAll(async () => {
    // Paid payroll and the audit log are immutable, so only the table owner can tidy up. Without an
    // owner connection the rows stay behind under this test's random ids; nothing else reads them.
    const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
    if (ownerUrl) {
      const owner = new Pool({ connectionString: ownerUrl });
      await owner.query("alter table payroll_items disable trigger payroll_items_lock");
      await owner.query("alter table audit_logs disable trigger audit_logs_no_delete");
      await owner.query("delete from organizations where id = $1", [org]);
      await owner.query("alter table payroll_items enable trigger payroll_items_lock");
      await owner.query("alter table audit_logs enable trigger audit_logs_no_delete");
      await owner.query('delete from "user" where id in ($1,$2)', [hrUser, checker]);
      await owner.end();
    }
    await pool.end();
  });

  it("assigns salary, keeps history append-only and rejects bad dates", async () => {
    const base = { structureId, ctcAnnual: 120_000_000, reason: "Offer" };
    await expect(
      run((h) => assignSalaryTx(h, { ...base, employeeId: emp.a, effectiveFrom: "2023-01-01" })),
    ).rejects.toThrow(/before the join date/);
    await run((h) =>
      assignSalaryTx(h, { ...base, employeeId: emp.a, effectiveFrom: "2024-04-01" }),
    );
    await run((h) =>
      assignSalaryTx(h, {
        ...base,
        employeeId: emp.b,
        ctcAnnual: 90_000_000,
        effectiveFrom: "2024-04-01",
      }),
    );
    await run((h) =>
      assignSalaryTx(h, {
        ...base,
        employeeId: emp.badBank,
        ctcAnnual: 60_000_000,
        effectiveFrom: "2024-04-01",
      }),
    );
    await expect(
      run((h) => assignSalaryTx(h, { ...base, employeeId: emp.a, effectiveFrom: "2024-04-01" })),
    ).rejects.toThrow(/must take effect after/);
    await run((h) =>
      assignSalaryTx(h, {
        ...base,
        employeeId: emp.a,
        ctcAnnual: 132_000_000,
        effectiveFrom: `${currentMonthIst()}-01`,
      }),
    );
    const rows = await withTenant(org, (tx) =>
      tx
        .select()
        .from(schema.employeeSalaries)
        .where(eq(schema.employeeSalaries.employeeId, emp.a)),
    );
    expect(rows).toHaveLength(2);
    const monthly = rows[0].breakdown.reduce(
      (s, l) => s + (l.type === "earning" ? l.monthly : 0),
      0,
    );
    expect(Math.abs(monthly * 12 - rows[0].ctcAnnual)).toBeLessThan(100);
    await expect(
      run((h) =>
        assignSalaryTx(h, { ...base, employeeId: randomUUID(), effectiveFrom: "2024-04-01" }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("locks attendance once, marks missing working days absent, refuses future months", async () => {
    await expect(run((h) => lockMonthTx(h, addMonths(currentMonthIst(), 1)))).rejects.toThrow(
      /future/,
    );
    await run((h) => lockMonthTx(h, month));
    const absent = await withTenant(org, (tx) =>
      tx
        .select()
        .from(schema.attendanceRecords)
        .where(
          and(
            eq(schema.attendanceRecords.employeeId, emp.a),
            eq(schema.attendanceRecords.status, "absent"),
          ),
        ),
    );
    expect(absent.length).toBeGreaterThan(15); // nobody checked in, so every working day is an absence
    await expect(run((h) => lockMonthTx(h, month))).rejects.toThrow(/already locked/);
  });

  it("creates a run: rejects future months, skips people without salary, pays only what the engine computed", async () => {
    await expect(run((h) => createRunTx(h, addMonths(currentMonthIst(), 1)))).rejects.toThrow(
      /future/,
    );
    const { id, skipped } = await run((h) => createRunTx(h, month));
    expect(skipped).toContain("N1 Svc");
    const items = await withTenant(org, (tx) =>
      tx.select().from(schema.payrollItems).where(eq(schema.payrollItems.runId, id)),
    );
    expect(items).toHaveLength(3);
    // Everyone was marked absent for the whole month, so loss of pay wipes most of the salary.
    for (const i of items) expect(i.lopDays).not.toBeNull();
    await expect(run((h) => createRunTx(h, month))).rejects.toThrow(/already exists/);
    await run((h) => submitRunTx(h, id));
    await expect(run((h) => submitRunTx(h, id))).rejects.toThrow(/Only a draft/);
    const [r] = await withTenant(org, (tx) =>
      tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, id)),
    );
    expect(r.status).toBe("review");
    expect(Number(r.totalNet)).toBe(items.reduce((s, i) => s + i.net, 0));
  });

  it("dispatches payments idempotently; one bad bank detail keeps the run open until fixed", async () => {
    const [r] = await withTenant(org, (tx) =>
      tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, month)),
    );
    // Stand in for approve and process (those need a signed-in user): the same state transitions.
    await withTenant(org, async (tx) => {
      await tx
        .update(schema.payrollRuns)
        .set({ status: "approved", approvedBy: checker })
        .where(eq(schema.payrollRuns.id, r.id));
      await tx
        .update(schema.payrollRuns)
        .set({ status: "processing" })
        .where(eq(schema.payrollRuns.id, r.id));
      const items = await tx
        .select()
        .from(schema.payrollItems)
        .where(eq(schema.payrollItems.runId, r.id));
      await tx.insert(schema.payments).values(
        items
          .filter((i) => i.net > 0)
          .map((i) => ({
            organizationId: org,
            runId: r.id,
            employeeId: i.employeeId,
            amount: i.net,
            idempotencyKey: `${r.id}:${i.employeeId}`,
          })),
      );
    });
    const queued = await withTenant(org, (tx) =>
      tx.select().from(schema.payments).where(eq(schema.payments.runId, r.id)),
    );
    const actor = { organizationId: org, userId: hrUser, role: "hr_admin" };
    const first = await dispatchRunPayments(actor, r.id);
    expect(first.sent + first.failed).toBe(queued.length);
    expect(first.failed).toBe(queued.some((p) => p.employeeId === emp.badBank) ? 1 : 0);
    if (first.failed === 1) {
      const [open] = await withTenant(org, (tx) =>
        tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, r.id)),
      );
      expect(open.status).toBe("processing");
      await withTenant(org, (tx) =>
        tx
          .update(schema.employees)
          .set({ bankIfsc: "HDFC0001234" })
          .where(eq(schema.employees.id, emp.badBank)),
      );
      const retry = await dispatchRunPayments(actor, r.id);
      expect(retry).toEqual({ sent: 1, failed: 0 });
    }
    const [done] = await withTenant(org, (tx) =>
      tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, r.id)),
    );
    expect(done.status).toBe("paid");
    // Nothing is sent twice.
    expect(await dispatchRunPayments(actor, r.id)).toEqual({ sent: 0, failed: 0 });
    const pays = await withTenant(org, (tx) =>
      tx.select().from(schema.payments).where(eq(schema.payments.runId, r.id)),
    );
    expect(pays.every((p) => p.status === "processed" && p.providerRef?.startsWith("sim_"))).toBe(
      true,
    );
    expect(new Set(pays.map((p) => p.idempotencyKey)).size).toBe(pays.length);
    expect(await withTenant(org, (tx) => settleRunIfComplete(tx, org, r.id))).toBe(false); // already paid
    // The frozen run cannot be edited any more, even by the table owner's app role.
    await expect(
      withTenant(org, (tx) =>
        tx.update(schema.payrollItems).set({ bonus: 1 }).where(eq(schema.payrollItems.runId, r.id)),
      ),
    ).rejects.toThrow();
  });

  it("validates payout destinations like a bank would", async () => {
    const req = {
      idempotencyKey: "k1",
      amountPaise: 100,
      name: "A",
      email: "a@x.in",
      narration: "Salary",
    };
    expect(
      await simulatedProvider.payout({ ...req, accountNumber: "12", ifsc: "HDFC0001234" }),
    ).toMatchObject({ status: "failed" });
    expect(
      await simulatedProvider.payout({ ...req, accountNumber: "123456789012", ifsc: "bad" }),
    ).toMatchObject({ status: "failed" });
    expect(
      await simulatedProvider.payout({
        ...req,
        accountNumber: "123456789012",
        ifsc: "HDFC0001234",
      }),
    ).toMatchObject({ status: "processed" });
    expect(getProvider().name).toBe("simulated");
  });

  it("builds leave balances once, prorates joiners and carries forward", async () => {
    const fy = fyStartOf(`${currentMonthIst()}-15`);
    await withTenant(org, (tx) =>
      ensureBalances(tx, org, { id: emp.a, joinDate: "2024-04-01" }, fy),
    );
    await withTenant(org, (tx) =>
      ensureBalances(tx, org, { id: emp.a, joinDate: "2024-04-01" }, fy),
    );
    const bal = await withTenant(org, (tx) =>
      tx
        .select()
        .from(schema.leaveBalances)
        .where(
          and(eq(schema.leaveBalances.employeeId, emp.a), eq(schema.leaveBalances.fyStart, fy)),
        ),
    );
    expect(bal).toHaveLength(4); // CL, SL, EL, LOP — not duplicated by the second call
    expect(fyStartOf("2026-03-31")).toBe(2025);
    expect(fyStartOf("2026-04-01")).toBe(2026);
    expect(prorateQuota(12, "2025-04-01", 2025)).toBe(12);
    expect(prorateQuota(12, "2025-10-15", 2025)).toBe(6);
    expect(prorateQuota(12, "2026-04-10", 2025)).toBe(0);
    // Carry-forward: earned leave carries up to its cap into next year.
    await withTenant(org, async (tx) => {
      const el = (
        await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.code, "EL"))
      )[0];
      await tx
        .update(schema.leaveBalances)
        .set({ used: "2" })
        .where(
          and(
            eq(schema.leaveBalances.employeeId, emp.a),
            eq(schema.leaveBalances.leaveTypeId, el.id),
            eq(schema.leaveBalances.fyStart, fy),
          ),
        );
    });
    await withTenant(org, (tx) =>
      ensureBalances(tx, org, { id: emp.a, joinDate: "2024-04-01" }, fy + 1),
    );
    const next = await withTenant(org, async (tx) => {
      const el = (
        await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.code, "EL"))
      )[0];
      return (
        await tx
          .select()
          .from(schema.leaveBalances)
          .where(
            and(
              eq(schema.leaveBalances.employeeId, emp.a),
              eq(schema.leaveBalances.leaveTypeId, el.id),
              eq(schema.leaveBalances.fyStart, fy + 1),
            ),
          )
      )[0];
    });
    expect(Number(next.allotted)).toBe(15 + 13);
  });
  it("the automatic pipeline advances safely, never approves or pays, and is repeatable", async () => {
    const m = addMonths(month, -1);
    const first = await advancePipeline(org, m);
    expect([...STEP_ORDER, "complete"]).toContain(first);
    const again = await advancePipeline(org, m);
    expect(again).toBe(first);
    const { steps, runs } = await withTenant(org, async (tx) => ({
      steps: await tx.select().from(schema.pipelineSteps).where(eq(schema.pipelineSteps.month, m)),
      runs: await tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, m)),
    }));
    expect(steps.find((x) => x.step === "lock")?.status).toBe("done");
    expect(steps.find((x) => x.step === "draft")?.status).toBe("done");
    expect(new Set(steps.map((x) => x.step)).size).toBe(steps.length); // one row per step
    expect(runs).toHaveLength(1); // repeating did not create a second run
    expect(["draft", "review"]).toContain(runs[0].status); // approval and payment stay with people
    expect(runs[0].createdBy).toBe(`system-${org}`);
    expect(typeof (await raiseDeadlineEvents(org, `${currentMonthIst()}-15`))).toBe("number");
  });
});
