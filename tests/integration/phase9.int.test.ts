import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { buildPersonalExport } from "@/lib/privacy/export";
import { MIN_RESPONSES, summarise } from "@/lib/surveys/results";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = describe.skipIf(!url);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err, "expected the database to reject the statement").not.toBeNull();
  expect(`${err?.message ?? ""} ${err?.cause?.message ?? ""}`).toMatch(pattern);
}

d("phase 9: advanced features", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const user1 = `u1-${randomUUID()}`;
  const user2 = `u2-${randomUUID()}`;
  let emp1 = "";
  let emp2 = "";
  let desig = "";
  const inTenant = <T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  const mkEmp = (org: string, n: number, userId: string | null) =>
    inTenant(org, async (tx) => {
      const [e] = await tx
        .insert(schema.employees)
        .values({
          organizationId: org,
          userId,
          employeeCode: `E${n}`,
          firstName: `First${n}`,
          lastName: "Tester",
          email: `e${n}-${org.slice(0, 6)}@x.in`,
          joinDate: "2024-01-01",
          panEnc: encrypt("ABCDE1234F"),
          bankAccountEnc: encrypt("123456789012"),
          panIndex: `idx-secret-${n}`,
        })
        .returning({ id: schema.employees.id });
      return e.id;
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await db.insert(schema.users).values([
      { id: user1, name: "One", email: `${user1}@x.in` },
      { id: user2, name: "Two", email: `${user2}@x.in` },
    ]);
    for (const id of [orgA, orgB])
      await inTenant(id, (tx) =>
        tx.insert(schema.organizations).values({ id, name: id, slug: `p9-${id.slice(0, 8)}` }),
      );
    emp1 = await mkEmp(orgA, 1, user1);
    emp2 = await mkEmp(orgA, 2, user2);
    desig = await inTenant(orgA, async (tx) => {
      const [r] = await tx
        .insert(schema.designations)
        .values({ organizationId: orgA, title: "Engineer" })
        .returning({ id: schema.designations.id });
      return r.id;
    });
  });

  afterAll(async () => {
    for (const id of [orgA, orgB])
      await inTenant(id, (tx) =>
        tx.delete(schema.organizations).where(eq(schema.organizations.id, id)),
      );
    await db.delete(schema.users).where(sql`${schema.users.id} in (${user1}, ${user2})`);
    await pool.end();
  });

  it("isolates every new table by company (RLS)", async () => {
    await inTenant(orgA, async (tx) => {
      await tx.insert(schema.ewaRequests).values({
        organizationId: orgA,
        employeeId: emp1,
        month: "2026-11",
        amount: 100000,
        earnedAtRequest: 500000,
      });
      await tx.insert(schema.recognitions).values({
        organizationId: orgA,
        fromEmployeeId: emp1,
        toEmployeeId: emp2,
        value: "teamwork",
        message: "Thanks a lot",
      });
      await tx.insert(schema.surveys).values({
        organizationId: orgA,
        title: "S",
        questions: [{ id: "q1", text: "Q", kind: "scale" }],
      });
      await tx
        .insert(schema.featureFlags)
        .values({ organizationId: orgA, key: "ewa", enabled: false });
      await tx
        .insert(schema.fxRates)
        .values({ organizationId: orgA, currency: "USD", perInr: "0.012" });
      await tx
        .insert(schema.privacyRequests)
        .values({ organizationId: orgA, userId: user1, employeeId: emp1, kind: "export" });
      await tx.insert(schema.salaryBenchmarks).values({
        organizationId: orgA,
        designationId: desig,
        p25: 1,
        p50: 2,
        p75: 3,
        source: "t",
        asOf: "2026-11-01",
      });
      await tx.insert(schema.ewaSettings).values({ organizationId: orgA });
    });
    const tables = [
      schema.ewaRequests,
      schema.recognitions,
      schema.surveys,
      schema.featureFlags,
      schema.fxRates,
      schema.privacyRequests,
      schema.salaryBenchmarks,
      schema.ewaSettings,
    ];
    for (const t of tables) {
      const own = await inTenant(orgA, (tx) => tx.select().from(t));
      const other = await inTenant(orgB, (tx) => tx.select().from(t));
      expect(own.length).toBeGreaterThan(0);
      expect(other).toHaveLength(0);
    }
    // writing into another company's id is refused
    await expectDbError(
      inTenant(orgB, (tx) =>
        tx
          .insert(schema.fxRates)
          .values({ organizationId: orgA, currency: "EUR", perInr: "0.011" }),
      ),
      /row-level security/i,
    );
  });

  it("enforces data rules in the database", async () => {
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.recognitions).values({
          organizationId: orgA,
          fromEmployeeId: emp1,
          toEmployeeId: emp1,
          value: "teamwork",
          message: "Self thanks",
        }),
      ),
      /recognitions_not_self/,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.fxRates).values({ organizationId: orgA, currency: "GBP", perInr: "0" }),
      ),
      /fx_rates_positive/,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.fxRates).values({ organizationId: orgA, currency: "USD", perInr: "0.02" }),
      ),
      /fx_rates_org_cur_uq/,
    );
    await expectDbError(
      inTenant(orgA, async (tx) => {
        const [x] = await tx
          .insert(schema.designations)
          .values({ organizationId: orgA, title: "Tmp" })
          .returning();
        await tx.insert(schema.salaryBenchmarks).values({
          organizationId: orgA,
          designationId: x.id,
          p25: 300,
          p50: 200,
          p75: 400,
          source: "t",
          asOf: "2026-11-01",
        });
      }),
      /salary_benchmarks_order/,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.ewaRequests).values({
          organizationId: orgA,
          employeeId: emp1,
          month: "2026-11",
          amount: 0,
          earnedAtRequest: 1,
        }),
      ),
      /ewa_requests_amount/,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.privacyRequests)
          .values({ organizationId: orgA, userId: user1, kind: "delete-everything" }),
      ),
      /privacy_requests_kind/,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.featureFlags).values({ organizationId: orgA, key: "ewa", enabled: true }),
      ),
      /feature_flags_org_key_uq/,
    );
  });

  it("survey answers carry no identity and one person can answer once", async () => {
    const cols = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'survey_responses'`,
    );
    const names = (cols.rows as { column_name: string }[]).map((r) => r.column_name);
    for (const banned of ["user_id", "employee_id", "created_at", "updated_at"])
      expect(names).not.toContain(banned);
    expect(names).toContain("submitted_on");

    const surveyId = await inTenant(orgA, async (tx) => {
      const [s] = await tx
        .insert(schema.surveys)
        .values({
          organizationId: orgA,
          title: "Anon",
          questions: [{ id: "q1", text: "Q", kind: "scale" }],
        })
        .returning({ id: schema.surveys.id });
      await tx
        .insert(schema.surveyParticipation)
        .values({ organizationId: orgA, surveyId: s.id, userId: user1 });
      return s.id;
    });
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.surveyParticipation)
          .values({ organizationId: orgA, surveyId, userId: user1 }),
      ),
      /survey_participation_uq/,
    );
    // Four answers are not enough to show anything; five are.
    const rowsFor = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        departmentId: null,
        answers: { q1: 1 + (i % 5) },
        sentiment: "neutral" as const,
      }));
    const qs = [{ id: "q1", text: "Q", kind: "scale" as const }];
    expect(summarise(qs, rowsFor(MIN_RESPONSES - 1)).visible).toBe(false);
    expect(summarise(qs, rowsFor(MIN_RESPONSES)).visible).toBe(true);
  });

  it("answers the single-sign-on question without exposing anything else", async () => {
    await inTenant(orgA, (tx) =>
      tx
        .update(schema.organizations)
        .set({ ssoDomains: ["acme-p9.test"] })
        .where(eq(schema.organizations.id, orgA)),
    );
    // Called with no company context at all, as sign-in does.
    const q = async (dom: string) =>
      ((await db.execute(sql`select sso_domain_enforced(${dom}) as e`)).rows[0] as { e: boolean })
        .e;
    expect(await q("acme-p9.test")).toBe(true);
    expect(await q("ACME-P9.TEST")).toBe(true);
    expect(await q("other.test")).toBe(false);
    // The app role cannot read organizations directly without a tenant.
    const direct = await db.select().from(schema.organizations);
    expect(direct).toHaveLength(0);
  });

  it("exports only the caller's own data, with ids masked and receipts left out", async () => {
    await inTenant(orgA, async (tx) => {
      await tx.insert(schema.expenseClaims).values({
        organizationId: orgA,
        employeeId: emp1,
        category: "Travel",
        amount: 12300,
        expenseDate: "2026-10-10",
        receiptData: Buffer.from("PRIVATE-IMAGE"),
        status: "submitted",
      });
      await tx.insert(schema.expenseClaims).values({
        organizationId: orgA,
        employeeId: emp2,
        category: "Meals",
        amount: 999,
        expenseDate: "2026-10-11",
        status: "submitted",
      });
    });
    const out = await inTenant(orgA, (tx) =>
      buildPersonalExport(tx, {
        organizationId: orgA,
        userId: user1,
        employeeId: emp1,
        email: "one@x.in",
      }),
    );
    const json = JSON.stringify(out);
    expect(json).toContain("First1");
    expect(json).not.toContain("First2");
    expect(json).not.toContain("ABCDE1234F");
    expect(json).not.toContain("123456789012");
    expect(json).not.toContain("idx-secret");
    expect(json).not.toContain("PRIVATE-IMAGE");
    expect((out.profile as { pan: string }).pan).toMatch(/1234F$|\*+/);
    expect(out.expenseClaims as unknown[]).toHaveLength(1);
  });

  it("only one open erasure request per person is possible through the action's check, and rows are well-formed", async () => {
    const rows = await inTenant(orgA, async (tx) => {
      await tx.insert(schema.privacyRequests).values({
        organizationId: orgA,
        userId: user2,
        employeeId: emp2,
        kind: "erasure",
        reason: "Left the company",
      });
      return tx
        .select()
        .from(schema.privacyRequests)
        .where(eq(schema.privacyRequests.userId, user2));
    });
    expect(rows[0].status).toBe("pending");
    expect(rows[0].decidedBy).toBeNull();
  });
});
