import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
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

d("workforce database guarantees", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const empA = randomUUID();
  const typeA = randomUUID();

  async function inTenant<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }
  const attendance = (
    date: string,
    extra: Partial<typeof schema.attendanceRecords.$inferInsert> = {},
  ) =>
    inTenant(orgA, (tx) =>
      tx
        .insert(schema.attendanceRecords)
        .values({ organizationId: orgA, employeeId: empA, date, ...extra })
        .returning(),
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    for (const id of [orgA, orgB])
      await inTenant(id, (tx) =>
        tx.insert(schema.organizations).values({ id, name: id, slug: `w-${id.slice(0, 8)}` }),
      );
    await inTenant(orgA, async (tx) => {
      await tx.insert(schema.employees).values({
        id: empA,
        organizationId: orgA,
        employeeCode: "W1",
        firstName: "W",
        email: "w@x.in",
        joinDate: "2024-01-01",
      });
      await tx
        .insert(schema.leaveTypes)
        .values({ id: typeA, organizationId: orgA, code: "CL", name: "Casual", annualQuota: "12" });
    });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("allows one attendance record per employee per day", async () => {
    await attendance("2026-01-05");
    await expectDbError(attendance("2026-01-05"), /unique|duplicate/i);
  });

  it("rejects a check-out before the check-in", async () => {
    await expectDbError(
      attendance("2026-01-06", {
        checkIn: new Date("2026-01-06T10:00:00Z"),
        checkOut: new Date("2026-01-06T09:00:00Z"),
      }),
      /attendance_times|check/i,
    );
  });

  it("freezes attendance once the month is locked", async () => {
    const [rec] = await attendance("2026-02-03");
    await inTenant(orgA, (tx) =>
      tx.insert(schema.attendanceLocks).values({ organizationId: orgA, month: "2026-02" }),
    );
    await expectDbError(attendance("2026-02-04"), /locked/i);
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .update(schema.attendanceRecords)
          .set({ status: "absent" })
          .where(eq(schema.attendanceRecords.id, rec.id)),
      ),
      /locked/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.delete(schema.attendanceRecords).where(eq(schema.attendanceRecords.id, rec.id)),
      ),
      /locked/i,
    );
    // Other months stay editable.
    await expect(attendance("2026-03-02")).resolves.toHaveLength(1);
  });

  it("never lets leave used exceed what was allotted", async () => {
    await inTenant(orgA, (tx) =>
      tx.insert(schema.leaveBalances).values({
        organizationId: orgA,
        employeeId: empA,
        leaveTypeId: typeA,
        fyStart: 2026,
        allotted: "2",
        used: "1",
      }),
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .update(schema.leaveBalances)
          .set({ used: "3" })
          .where(eq(schema.leaveBalances.employeeId, empA)),
      ),
      /leave_balances_nonneg|check/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.leaveBalances)
          .values({ organizationId: orgA, employeeId: empA, leaveTypeId: typeA, fyStart: 2026 }),
      ),
      /unique|duplicate/i,
    );
  });

  it("rejects leave requests that end before they start or have no days", async () => {
    const base = { organizationId: orgA, employeeId: empA, leaveTypeId: typeA };
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.leaveRequests)
          .values({ ...base, fromDate: "2026-05-10", toDate: "2026-05-09", days: "1" }),
      ),
      /check/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.leaveRequests)
          .values({ ...base, fromDate: "2026-05-10", toDate: "2026-05-10", days: "0" }),
      ),
      /check/i,
    );
  });

  it("rejects zero or negative expense amounts", async () => {
    for (const amount of [0, -100])
      await expectDbError(
        inTenant(orgA, (tx) =>
          tx.insert(schema.expenseClaims).values({
            organizationId: orgA,
            employeeId: empA,
            category: "Travel",
            amount,
            expenseDate: "2026-05-01",
          }),
        ),
        /expense_claims_amount|check/i,
      );
  });

  it("keeps one compliance item per kind and period, and only known statuses", async () => {
    const row = { organizationId: orgA, kind: "PF", period: "2026-04", dueDate: "2026-05-15" };
    await inTenant(orgA, (tx) => tx.insert(schema.complianceItems).values(row));
    await expectDbError(
      inTenant(orgA, (tx) => tx.insert(schema.complianceItems).values(row)),
      /unique|duplicate/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.complianceItems).values({ ...row, kind: "ESI", status: "weird" }),
      ),
      /compliance_items_status|check/i,
    );
  });

  it("keeps workforce data invisible to other organizations", async () => {
    const tables = [
      schema.attendanceRecords,
      schema.leaveTypes,
      schema.leaveBalances,
      schema.complianceItems,
      schema.attendanceLocks,
    ] as const;
    for (const t of tables) {
      const rows = await inTenant(orgB, (tx) => tx.select().from(t));
      expect(rows, "org B must see nothing from org A").toHaveLength(0);
    }
    await expectDbError(
      inTenant(orgB, (tx) =>
        tx
          .insert(schema.attendanceRecords)
          .values({ organizationId: orgA, employeeId: empA, date: "2026-06-01" }),
      ),
      /row-level security|policy/i,
    );
  });

  it("keeps announcements per company and enforces their length limits", async () => {
    await inTenant(orgA, (tx) =>
      tx.insert(schema.announcements).values({
        organizationId: orgA,
        title: "Diwali holiday",
        body: "Office closed on Friday.",
      }),
    );
    const seenByB = await inTenant(orgB, (tx) => tx.select().from(schema.announcements));
    expect(seenByB).toHaveLength(0);
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx.insert(schema.announcements).values({ organizationId: orgA, title: "", body: "x" }),
      ),
      /announcements_title_len|check/i,
    );
    await expectDbError(
      inTenant(orgA, (tx) =>
        tx
          .insert(schema.announcements)
          .values({ organizationId: orgA, title: "ok", body: "x".repeat(2001) }),
      ),
      /announcements_body_len|check/i,
    );
    await expectDbError(
      inTenant(orgB, (tx) =>
        tx.insert(schema.announcements).values({ organizationId: orgA, title: "spoof", body: "x" }),
      ),
      /row-level security|policy/i,
    );
  });
});
