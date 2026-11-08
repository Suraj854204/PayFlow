import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { queryAudit, writeAudit } from "@/lib/audit";
import { verifyChain } from "@/lib/audit-chain";

const url = process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!url);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err, "expected the database to reject the statement").not.toBeNull();
  expect(`${err?.message ?? ""} ${err?.cause?.message ?? ""}`).toMatch(pattern);
}

d("payroll database guarantees", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const maker = `u-${randomUUID()}`;
  const checker = `u-${randomUUID()}`;
  const empA = randomUUID();

  async function inTenant<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }
  const newRun = (
    org: string,
    month: string,
    extra: Partial<typeof schema.payrollRuns.$inferInsert> = {},
  ) =>
    inTenant(org, (tx) =>
      tx
        .insert(schema.payrollRuns)
        .values({ organizationId: org, month, createdBy: maker, ...extra })
        .returning(),
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    for (const id of [maker, checker])
      await db.insert(schema.users).values({ id, name: id, email: `${id}@x.in` });
    for (const id of [orgA, orgB])
      await inTenant(id, (tx) =>
        tx.insert(schema.organizations).values({ id, name: id, slug: `p-${id.slice(0, 8)}` }),
      );
    await inTenant(orgA, (tx) =>
      tx.insert(schema.employees).values({
        id: empA,
        organizationId: orgA,
        employeeCode: "E1",
        firstName: "A",
        email: "a@x.in",
        joinDate: "2024-01-01",
      }),
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  it("allows only one live run per month, and a cancelled run frees the month", async () => {
    const [r] = await newRun(orgA, "2026-04");
    await expectDbError(newRun(orgA, "2026-04"), /unique|duplicate/i);
    await inTenant(orgA, (tx) =>
      tx
        .update(schema.payrollRuns)
        .set({ status: "cancelled" })
        .where(eq(schema.payrollRuns.id, r.id)),
    );
    await expect(newRun(orgA, "2026-04")).resolves.toHaveLength(1);
  });

  it("rejects a malformed month", async () => {
    await expectDbError(newRun(orgA, "2026-13"), /month_fmt|check/i);
  });

  it("enforces maker-checker in the database", async () => {
    const [r] = await newRun(orgA, "2026-05");
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .update(schema.payrollRuns)
          .set({ approvedBy: maker })
          .where(eq(schema.payrollRuns.id, r.id)),
      ),
      /maker_checker|check/i,
    );
    await expect(
      inTenant(orgA, (tx) =>
        tx
          .update(schema.payrollRuns)
          .set({ approvedBy: checker })
          .where(eq(schema.payrollRuns.id, r.id)),
      ),
    ).resolves.toBeDefined();
  });

  it("locks items once the run leaves draft", async () => {
    const [r] = await newRun(orgA, "2026-06");
    const [item] = await inTenant(orgA, (tx) =>
      tx
        .insert(schema.payrollItems)
        .values({ organizationId: orgA, runId: r.id, employeeId: empA, net: 100 })
        .returning(),
    );
    await inTenant(orgA, (tx) =>
      tx.update(schema.payrollItems).set({ net: 200 }).where(eq(schema.payrollItems.id, item.id)),
    );
    await inTenant(orgA, (tx) =>
      tx
        .update(schema.payrollRuns)
        .set({ status: "approved" })
        .where(eq(schema.payrollRuns.id, r.id)),
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.update(schema.payrollItems).set({ net: 999 }).where(eq(schema.payrollItems.id, item.id)),
      ),
      /locked/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.delete(schema.payrollItems).where(eq(schema.payrollItems.id, item.id)),
      ),
      /locked/i,
    );
  });

  it("makes payments idempotent per organization", async () => {
    const [r] = await newRun(orgA, "2026-07");
    const pay = () =>
      inTenant(orgA, (tx) =>
        tx.insert(schema.payments).values({
          organizationId: orgA,
          runId: r.id,
          employeeId: empA,
          amount: 500,
          idempotencyKey: `${r.id}:${empA}`,
        }),
      );
    await pay();
    await expectDbError(pay(), /unique|duplicate/i);
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.payments)
          .values({ organizationId: orgA, employeeId: empA, amount: 0, idempotencyKey: "zero" }),
      ),
      /amount_positive|check/i,
    );
  });

  it("isolates payroll data between tenants", async () => {
    const seenByB = await inTenant(orgB, (tx) => tx.select().from(schema.payrollRuns));
    expect(seenByB).toHaveLength(0);
    await expectDbError(
      inTenant(orgB, (tx) =>
        tx
          .insert(schema.payrollRuns)
          .values({ organizationId: orgA, month: "2026-08", createdBy: maker }),
      ),
      /row-level security/i,
    );
  });

  it("deduplicates webhook events and resolves payment owners", async () => {
    const ins = () =>
      db
        .insert(schema.webhookEvents)
        .values({ provider: "razorpay", eventId: `evt_${orgA}`, eventType: "payout.processed" });
    await ins();
    await expectDbError(ins(), /unique|duplicate/i);
    const [r] = await newRun(orgA, "2026-09");
    await inTenant(orgA, (tx) =>
      tx.insert(schema.payments).values({
        organizationId: orgA,
        runId: r.id,
        employeeId: empA,
        amount: 1,
        idempotencyKey: "k-ref",
        providerRef: `pout_${orgA}`,
      }),
    );
    const res = await db.execute(sql`select payment_org_by_ref(${`pout_${orgA}`}) as org`);
    expect((res.rows[0] as { org: string }).org).toBe(orgA);
  });

  it("keeps loan balances sane", async () => {
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.loans).values({
          organizationId: orgA,
          employeeId: empA,
          principal: 1000,
          emi: 100,
          balance: 2000,
          startMonth: "2026-04",
        }),
      ),
      /loans_amounts|check/i,
    );
  });

  it("filters the audit log literally (underscore is not a wildcard)", async () => {
    await inTenant(orgA, async (tx) => {
      for (const action of ["payroll_run.created", "payrollXrun.created", "loan.created"])
        await writeAudit(tx, {
          organizationId: orgA,
          actorUserId: null,
          actorRole: "system",
          action,
          entityType: "t",
        });
    });
    const hits = await inTenant(orgA, (tx) => queryAudit(tx, orgA, { action: "payroll_run" }));
    expect(hits.map((h) => h.action)).toEqual(["payroll_run.created"]);
    const dated = await inTenant(orgA, (tx) => queryAudit(tx, orgA, { from: "2999-01-01" }));
    expect(dated).toHaveLength(0);
  });

  it("keeps the audit chain valid when payloads contain undefined values and dates", async () => {
    await inTenant(orgB, async (tx) => {
      await writeAudit(tx, {
        organizationId: orgB,
        actorUserId: null,
        actorRole: "system",
        action: "x.exported",
        entityType: "t",
        metadata: { filter: { action: "p", from: undefined } },
        newValues: { at: new Date("2026-01-01T00:00:00Z"), n: undefined },
      });
    });
    const rows = await inTenant(orgB, (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgB))
        .orderBy(schema.auditLogs.seq),
    );
    const res = verifyChain(
      rows.map((r) => ({
        organizationId: r.organizationId,
        seq: r.seq,
        actorUserId: r.actorUserId,
        actorRole: r.actorRole,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        oldValues: r.oldValues,
        newValues: r.newValues,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
        prevHash: r.prevHash,
        hash: r.hash,
      })),
    );
    expect(res).toEqual({ valid: true });
  });
});
