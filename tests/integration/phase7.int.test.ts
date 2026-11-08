import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { searchPolicies } from "@/lib/policy/search";

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

d("phase 7 tables", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const user = `u-${randomUUID()}`;
  const emp = randomUUID();
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
        tx.insert(schema.organizations).values({ id, name: id, slug: `p7-${id.slice(0, 8)}` }),
      );
    await inTenant(orgA, (tx) =>
      tx.insert(schema.employees).values({
        id: emp,
        organizationId: orgA,
        employeeCode: "P7",
        firstName: "P",
        email: "p7@x.in",
        joinDate: "2024-01-01",
      }),
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  const action = (org: string, extra: Partial<typeof schema.aiActions.$inferInsert> = {}) =>
    inTenant(org, (tx) =>
      tx
        .insert(schema.aiActions)
        .values({
          organizationId: org,
          userId: user,
          kind: "approve_leave",
          params: { requestId: "x" },
          preview: { title: "t", summary: "s", changes: [], warnings: [] },
          expiresAt: new Date(Date.now() + 60_000),
          ...extra,
        })
        .returning(),
    );

  it("stores proposed actions per organisation and defaults them to pending", async () => {
    const [a] = await action(orgA);
    expect(a.status).toBe("pending");
    expect(await inTenant(orgA, (tx) => tx.select().from(schema.aiActions))).toHaveLength(1);
    expect(await inTenant(orgB, (tx) => tx.select().from(schema.aiActions))).toHaveLength(0);
  });

  it("rejects an unknown action status", async () => {
    await expectDbError(action(orgA, { status: "done" as "pending" }), /check|constraint/i);
  });

  it("finds policy passages by keyword, only inside the organisation", async () => {
    await inTenant(orgA, async (tx) => {
      const [doc] = await tx
        .insert(schema.policyDocuments)
        .values({
          organizationId: orgA,
          title: "Leave policy",
          filename: "leave.pdf",
          pages: 2,
          chunkCount: 2,
        })
        .returning();
      await tx.insert(schema.policyChunks).values([
        {
          organizationId: orgA,
          documentId: doc.id,
          idx: 0,
          page: 1,
          content: "Employees are entitled to twelve casual leaves in a financial year.",
        },
        {
          organizationId: orgA,
          documentId: doc.id,
          idx: 1,
          page: 2,
          content: "The notice period for confirmed employees is sixty days.",
        },
      ]);
    });
    const a = await inTenant(orgA, (tx) =>
      searchPolicies(tx, orgA, "what is the notice period", 3),
    );
    expect(a.mode).toBe("keyword");
    expect(a.hits[0].content).toContain("sixty days");
    expect(a.hits[0].page).toBe(2);
    expect(a.hits[0].title).toBe("Leave policy");
    const b = await inTenant(orgB, (tx) => searchPolicies(tx, orgB, "notice period", 3));
    expect(b.hits).toHaveLength(0);
    const none = await inTenant(orgA, (tx) =>
      searchPolicies(tx, orgA, "cryptocurrency staking", 3),
    );
    expect(none.hits).toHaveLength(0);
  });

  it("deleting a policy removes its passages", async () => {
    await inTenant(orgA, async (tx) => {
      await tx.delete(schema.policyDocuments);
      expect(await tx.select().from(schema.policyChunks)).toHaveLength(0);
    });
  });

  it("limits document extractions to known kinds, statuses and engines", async () => {
    const row = {
      organizationId: orgA,
      employeeId: emp,
      kind: "pan",
      filename: "pan.jpg",
      fieldsEnc: "v1:x:y:z",
      engine: "manual",
    };
    await inTenant(orgA, (tx) => tx.insert(schema.documentExtractions).values(row));
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.documentExtractions).values({ ...row, kind: "passport" }),
      ),
      /check|constraint/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.documentExtractions).values({ ...row, status: "approved" }),
      ),
      /check|constraint/i,
    );
    expect(await inTenant(orgB, (tx) => tx.select().from(schema.documentExtractions))).toHaveLength(
      0,
    );
  });
});

d("policy search quality", () => {
  it("matches a loosely worded question but not an unrelated one", async () => {
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    const org = randomUUID();
    const inT = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
        return fn(tx as unknown as Tx);
      });
    await inT((tx) =>
      tx.insert(schema.organizations).values({ id: org, name: org, slug: `q-${org.slice(0, 8)}` }),
    );
    await inT(async (tx) => {
      const [doc] = await tx
        .insert(schema.policyDocuments)
        .values({ organizationId: org, title: "Leave and Notice Policy", filename: "n.pdf" })
        .returning();
      await tx.insert(schema.policyChunks).values({
        organizationId: org,
        documentId: doc.id,
        idx: 0,
        page: 1,
        content:
          "Leave and Notice Policy. The notice period for confirmed employees is sixty days.",
      });
    });
    const loose = await inT((tx) =>
      searchPolicies(tx, org, "how many days of notice do I have to serve", 3),
    );
    expect(loose.hits[0]?.content).toContain("sixty days");
    const unrelated = await inT((tx) =>
      searchPolicies(tx, org, "What is the policy on cryptocurrency staking?", 3),
    );
    expect(unrelated.hits).toHaveLength(0);
    await pool.end();
  });
});
