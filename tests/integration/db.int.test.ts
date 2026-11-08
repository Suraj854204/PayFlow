import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { verifyChain } from "@/lib/audit-chain";
import type { Tx } from "@/lib/db";

/**
 * Runs against a real Postgres where the migration + drizzle/rls.sql are applied, connecting as a
 * NON-owner role (RLS does not apply to owners). Set TEST_DATABASE_URL to enable.
 */
const url = process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!url);

/** Drizzle wraps driver errors as "Failed query"; the Postgres message lives on `.cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err, "expected the database to reject the statement").not.toBeNull();
  expect(`${err?.message ?? ""} ${err?.cause?.message ?? ""}`).toMatch(pattern);
}

d("database integration (RLS + audit chain)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();

  async function inTenant<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    for (const [id, slug] of [
      [orgA, `a-${orgA.slice(0, 6)}`],
      [orgB, `b-${orgB.slice(0, 6)}`],
    ]) {
      await inTenant(id, (tx) => tx.insert(schema.organizations).values({ id, name: slug, slug }));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("isolates departments between tenants", async () => {
    await inTenant(orgA, (tx) =>
      tx.insert(schema.departments).values({ organizationId: orgA, name: "Engineering" }),
    );
    await inTenant(orgB, (tx) =>
      tx.insert(schema.departments).values({ organizationId: orgB, name: "Sales" }),
    );

    const seenByA = await inTenant(orgA, (tx) => tx.select().from(schema.departments));
    expect(seenByA.map((r) => r.name)).toEqual(["Engineering"]);

    // Forgetting the tenant filter, or explicitly asking for another tenant, still returns nothing.
    const leak = await inTenant(orgA, (tx) =>
      tx.select().from(schema.departments).where(eq(schema.departments.organizationId, orgB)),
    );
    expect(leak).toHaveLength(0);
  });

  it("rejects writing rows into another tenant", async () => {
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.departments).values({ organizationId: orgB, name: "Hacked" }),
      ),
      /row-level security/i,
    );
  });

  it("sees no rows at all when no tenant is set", async () => {
    const rows = await db.select().from(schema.departments);
    expect(rows).toHaveLength(0);
  });

  it("writes a valid hash chain, even with concurrent writers", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        inTenant(orgA, (tx) =>
          writeAudit(tx, {
            organizationId: orgA,
            actorUserId: "u1",
            actorRole: "hr_admin",
            action: "test.event",
            entityType: "thing",
            entityId: String(i),
            oldValues: { n: i - 1 },
            newValues: { n: i },
          }),
        ),
      ),
    );

    const rows = await inTenant(orgA, (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgA))
        .orderBy(asc(schema.auditLogs.seq)),
    );
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(
      verifyChain(
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
      ),
    ).toEqual({ valid: true });
  });

  it("rolls the audit entry back together with a failed business change", async () => {
    await expect(
      inTenant(orgB, async (tx) => {
        await writeAudit(tx, {
          organizationId: orgB,
          actorUserId: "u1",
          actorRole: "super_admin",
          action: "should.rollback",
          entityType: "thing",
        });
        throw new Error("business logic failed");
      }),
    ).rejects.toThrow("business logic failed");

    const rows = await inTenant(orgB, (tx) =>
      tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "should.rollback")),
    );
    expect(rows).toHaveLength(0);
  });

  it("blocks updates and deletes on the audit log", async () => {
    await expectDbError(
      inTenant(orgA, (tx) => tx.update(schema.auditLogs).set({ action: "tampered" })),
      /append-only/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) => tx.delete(schema.auditLogs)),
      /append-only/i,
    );
  });
});
