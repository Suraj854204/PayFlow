import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { analyzeRun } from "@/lib/anomaly/load";
import { tokensUsedToday, logUsage } from "@/lib/ai/usage";

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

d("AI tables", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const user = `u-${randomUUID()}`;
  const runId = randomUUID();
  const inTenant = <T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await db.insert(schema.users).values({ id: user, name: user, email: `${user}@x.in` });
    for (const id of [orgA, orgB])
      await inTenant(id, (tx) =>
        tx.insert(schema.organizations).values({ id, name: id, slug: `a-${id.slice(0, 8)}` }),
      );
    await inTenant(orgA, (tx) =>
      tx
        .insert(schema.payrollRuns)
        .values({ id: runId, organizationId: orgA, month: "2026-05", createdBy: user }),
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  it("hides chat sessions from other organisations", async () => {
    await inTenant(orgA, (tx) =>
      tx.insert(schema.chatSessions).values({ organizationId: orgA, userId: user, title: "Hi" }),
    );
    expect(await inTenant(orgA, (tx) => tx.select().from(schema.chatSessions))).toHaveLength(1);
    expect(await inTenant(orgB, (tx) => tx.select().from(schema.chatSessions))).toHaveLength(0);
  });

  it("rejects a bad feedback value and an unknown role", async () => {
    const [s] = await inTenant(orgA, (tx) => tx.select().from(schema.chatSessions));
    const base = { organizationId: orgA, sessionId: s.id, content: "x" };
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.chatMessages).values({ ...base, role: "assistant", feedback: 5 }),
      ),
      /check|constraint/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.chatMessages).values({ ...base, role: "system" as "user" }),
      ),
      /check|constraint/i,
    );
  });

  it("sums today's token usage per user and enforces the status list", async () => {
    await inTenant(orgA, (tx) =>
      logUsage(tx, {
        organizationId: orgA,
        userId: user,
        feature: "paybot",
        model: "m",
        inputTokens: 100,
        outputTokens: 50,
        status: "ok",
      }),
    );
    expect(await inTenant(orgA, (tx) => tokensUsedToday(tx, orgA, user))).toBe(150);
    expect(await inTenant(orgB, (tx) => tokensUsedToday(tx, orgB, user))).toBe(0);
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.aiUsage).values({
          organizationId: orgA,
          userId: user,
          feature: "x",
          model: "m",
          inputTokens: 1,
          outputTokens: 1,
          costMicroUsd: 1,
          status: "weird" as "ok",
        }),
      ),
      /check|constraint/i,
    );
  });

  it("keeps one dismissal per anomaly and requires a reason", async () => {
    const row = {
      organizationId: orgA,
      runId,
      key: "spike:1",
      reason: "Promotion",
      dismissedBy: user,
    };
    await inTenant(orgA, (tx) => tx.insert(schema.anomalyDismissals).values(row));
    await expectDbError(
      inTenant(orgA, (tx) => tx.insert(schema.anomalyDismissals).values(row)),
      /unique|duplicate/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.anomalyDismissals).values({ ...row, key: "k2", reason: "x" }),
      ),
      /check|constraint/i,
    );
  });

  it("analyses a run and lists the dismissal", async () => {
    const a = await inTenant(orgA, (tx) => analyzeRun(tx, orgA, runId, "2026-05-31"));
    expect(a).not.toBeNull();
    expect(a!.dismissed.length).toBeGreaterThanOrEqual(0);
    expect(a!.checks.length).toBeGreaterThan(0);
  });
});

d("30-day months", () => {
  it("analyses a November run without an invalid date", async () => {
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    const org = randomUUID();
    const u = `u-${randomUUID()}`;
    const run = randomUUID();
    const inT = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
        return fn(tx as unknown as Tx);
      });
    await db.insert(schema.users).values({ id: u, name: u, email: `${u}@x.in` });
    await inT((tx) =>
      tx.insert(schema.organizations).values({ id: org, name: org, slug: `n-${org.slice(0, 8)}` }),
    );
    await inT((tx) =>
      tx
        .insert(schema.payrollRuns)
        .values({ id: run, organizationId: org, month: "2026-11", createdBy: u }),
    );
    const a = await inT((tx) => analyzeRun(tx, org, run, "2026-11-30"));
    expect(a?.month).toBe("2026-11");
    await pool.end();
  });
});
