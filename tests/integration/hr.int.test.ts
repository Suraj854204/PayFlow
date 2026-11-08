import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import type { Tx } from "@/lib/db";

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

d("HR tables (real Postgres, non-owner role)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();

  const inTenant = <T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });

  const emp = (org: string, code: string, email: string) => ({
    organizationId: org,
    employeeCode: code,
    firstName: "Test",
    email,
    joinDate: "2026-04-01",
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    for (const id of [orgA, orgB]) {
      await inTenant(id, (tx) =>
        tx.insert(schema.organizations).values({ id, name: id, slug: `o-${id.slice(0, 8)}` }),
      );
    }
  });
  afterAll(async () => pool.end());

  it("isolates employees between tenants and blocks cross-tenant writes", async () => {
    await inTenant(orgA, (tx) => tx.insert(schema.employees).values(emp(orgA, "E1", "a@x.in")));
    await inTenant(orgB, (tx) => tx.insert(schema.employees).values(emp(orgB, "E1", "a@x.in")));

    // Same code and email in two different companies is fine.
    const seenByA = await inTenant(orgA, (tx) => tx.select().from(schema.employees));
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0].organizationId).toBe(orgA);

    await expectDbError(
      inTenant(orgA, (tx) => tx.insert(schema.employees).values(emp(orgB, "E9", "z@x.in"))),
      /row-level security/i,
    );
  });

  it("enforces unique code/email per company, but frees them after a soft delete", async () => {
    await inTenant(orgA, (tx) => tx.insert(schema.employees).values(emp(orgA, "E2", "b@x.in")));
    await expectDbError(
      inTenant(orgA, (tx) => tx.insert(schema.employees).values(emp(orgA, "E2", "other@x.in"))),
      /employees_org_code_uq|duplicate key/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) => tx.insert(schema.employees).values(emp(orgA, "E3", "b@x.in"))),
      /employees_org_email_uq|duplicate key/i,
    );
    await inTenant(orgA, (tx) =>
      tx
        .update(schema.employees)
        .set({ deletedAt: new Date() })
        .where(eq(schema.employees.employeeCode, "E2")),
    );
    await inTenant(orgA, (tx) => tx.insert(schema.employees).values(emp(orgA, "E2", "b@x.in")));
  });

  it("stores sensitive fields encrypted and never as plaintext", async () => {
    const pan = "ABCDE1234F";
    const [row] = await inTenant(orgA, (tx) =>
      tx
        .insert(schema.employees)
        .values({ ...emp(orgA, "E4", "c@x.in"), panEnc: encrypt(pan) })
        .returning(),
    );
    const [raw] = await inTenant(orgA, (tx) =>
      tx
        .execute<{ pan_enc: string }>(sql`select pan_enc from employees where id = ${row.id}`)
        .then((r) => r.rows),
    );
    expect(raw.pan_enc).not.toContain(pan);
    expect(decrypt(raw.pan_enc)).toBe(pan);
  });

  it("keeps salary history append-only per effective date and stores crore-level CTC", async () => {
    const [e] = await inTenant(orgA, (tx) =>
      tx
        .insert(schema.employees)
        .values(emp(orgA, "E5", "d@x.in"))
        .returning({ id: schema.employees.id }),
    );
    const ctc = 5_00_00_000_00; // ₹5 crore in paise, far above a 32-bit integer
    const base = {
      organizationId: orgA,
      employeeId: e.id,
      ctcAnnual: ctc,
      breakdown: [],
    };
    await inTenant(orgA, (tx) =>
      tx.insert(schema.employeeSalaries).values({ ...base, effectiveFrom: "2026-04-01" }),
    );
    const [row] = await inTenant(orgA, (tx) =>
      tx.select().from(schema.employeeSalaries).where(eq(schema.employeeSalaries.employeeId, e.id)),
    );
    expect(row.ctcAnnual).toBe(ctc);
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.employeeSalaries).values({ ...base, effectiveFrom: "2026-04-01" }),
      ),
      /employee_salaries_emp_eff_uq|duplicate key/i,
    );
  });

  it("round-trips binary documents byte for byte", async () => {
    const [e] = await inTenant(orgA, (tx) =>
      tx
        .insert(schema.employees)
        .values(emp(orgA, "E6", "e@x.in"))
        .returning({ id: schema.employees.id }),
    );
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10, 0x80]);
    const [doc] = await inTenant(orgA, (tx) =>
      tx
        .insert(schema.employeeDocuments)
        .values({
          organizationId: orgA,
          employeeId: e.id,
          type: "pan",
          fileName: "x.pdf",
          mimeType: "application/pdf",
          sizeBytes: bytes.length,
          data: bytes,
        })
        .returning({ id: schema.employeeDocuments.id }),
    );
    const [back] = await inTenant(orgA, (tx) =>
      tx.select().from(schema.employeeDocuments).where(eq(schema.employeeDocuments.id, doc.id)),
    );
    expect(Buffer.compare(back.data, bytes)).toBe(0);
    // Another tenant cannot read it.
    const other = await inTenant(orgB, (tx) =>
      tx.select().from(schema.employeeDocuments).where(eq(schema.employeeDocuments.id, doc.id)),
    );
    expect(other).toHaveLength(0);
  });

  it("invitations are visible only to the tenant or to someone holding the token", async () => {
    const token = "tok_" + randomUUID() + randomUUID();
    const hash = createHash("sha256").update(token).digest("hex");
    await inTenant(orgA, (tx) =>
      tx.insert(schema.invitations).values({
        organizationId: orgA,
        email: "new@x.in",
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );

    // Tenant B cannot see it.
    expect(
      await inTenant(orgB, (tx) =>
        tx.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, hash)),
      ),
    ).toHaveLength(0);

    // No tenant, no token: invisible. This is the "forgot the filter" case.
    expect(
      await db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, hash)),
    ).toHaveLength(0);

    // A wrong token reveals nothing.
    const wrong = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.invite_hash', ${"0".repeat(64)}, true)`);
      return tx.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, hash));
    });
    expect(wrong).toHaveLength(0);

    // The right token reveals exactly that invitation and lets it be marked accepted.
    const accepted = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.invite_hash', ${hash}, true)`);
      const [inv] = await tx
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.tokenHash, hash));
      expect(inv.organizationId).toBe(orgA);
      await tx
        .update(schema.invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invitations.id, inv.id));
      return inv.id;
    });
    expect(accepted).toBeTruthy();

    // Holding a token must not unlock other tables.
    const leak = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.invite_hash', ${hash}, true)`);
      return tx.select().from(schema.employees);
    });
    expect(leak).toHaveLength(0);
  });

  it("scopes checklist items and components by tenant", async () => {
    const [e] = await inTenant(orgA, (tx) =>
      tx
        .insert(schema.employees)
        .values(emp(orgA, "E7", "f@x.in"))
        .returning({ id: schema.employees.id }),
    );
    await inTenant(orgA, (tx) =>
      tx
        .insert(schema.checklistItems)
        .values({ organizationId: orgA, employeeId: e.id, kind: "onboarding", title: "x" }),
    );
    await inTenant(orgA, (tx) =>
      tx
        .insert(schema.salaryComponents)
        .values({ organizationId: orgA, name: "Basic", code: "BASIC" }),
    );
    expect(await inTenant(orgB, (tx) => tx.select().from(schema.checklistItems))).toHaveLength(0);
    expect(await inTenant(orgB, (tx) => tx.select().from(schema.salaryComponents))).toHaveLength(0);
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.salaryComponents)
          .values({ organizationId: orgA, name: "Basic 2", code: "BASIC" }),
      ),
      /salary_components_org_code_uq|duplicate key/i,
    );
  });
});

d("user-scoped reads (listing my own companies before a tenant is chosen)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgC = randomUUID();
  const alice = `u-${randomUUID()}`;
  const bob = `u-${randomUUID()}`;

  const inTenant = <T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  const asUser = <T>(user: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_user', ${user}, true)`);
      return fn(tx as unknown as Tx);
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    for (const u of [alice, bob]) {
      await db.insert(schema.users).values({ id: u, name: u, email: `${u}@x.in` });
    }
    for (const [org, user] of [
      [orgA, alice],
      [orgB, alice],
      [orgC, bob],
    ] as const) {
      await inTenant(org, async (tx) => {
        await tx
          .insert(schema.organizations)
          .values({ id: org, name: org, slug: `s-${org.slice(0, 8)}` });
        await tx
          .insert(schema.memberships)
          .values({ organizationId: org, userId: user, role: "super_admin" });
      });
    }
  });
  afterAll(async () => pool.end());

  it("lets a user list exactly their own memberships and companies across tenants", async () => {
    const rows = await asUser(alice, (tx) =>
      tx
        .select({ org: schema.organizations.id, user: schema.memberships.userId })
        .from(schema.memberships)
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.memberships.organizationId),
        ),
    );
    expect(rows.map((r) => r.org).sort()).toEqual([orgA, orgB].sort());
    expect(rows.every((r) => r.user === alice)).toBe(true);
  });

  it("shows nothing when neither user nor tenant is set", async () => {
    expect(await db.select().from(schema.memberships)).toHaveLength(0);
    expect(await db.select().from(schema.organizations)).toHaveLength(0);
  });

  it("does not let user scope write or read other users' data", async () => {
    await expectDbError(
      asUser(alice, (tx) =>
        tx
          .insert(schema.memberships)
          .values({ organizationId: orgA, userId: alice, role: "employee" }),
      ),
      /row-level security/i,
    );
    expect(await asUser(alice, (tx) => tx.select().from(schema.employees))).toHaveLength(0);
    const bobs = await asUser(alice, (tx) =>
      tx.select().from(schema.memberships).where(eq(schema.memberships.userId, bob)),
    );
    expect(bobs).toHaveLength(0);
  });
});
