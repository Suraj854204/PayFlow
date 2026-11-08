import { and, count, desc, eq, isNull } from "drizzle-orm";
import { authenticate, isResponse, ok, paging } from "@/lib/api/auth";
import { serializeEmployee } from "@/lib/api/serialize";
import { withTenant } from "@/lib/db";
import { employees } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const caller = await authenticate(req, "employees:read");
  if (isResponse(caller)) return caller;
  const url = new URL(req.url);
  const { limit, page, offset } = paging(url);
  const status = url.searchParams.get("status");
  const where = and(
    eq(employees.organizationId, caller.orgId),
    isNull(employees.deletedAt),
    status && ["active", "probation", "notice", "exited"].includes(status)
      ? eq(employees.status, status as "active")
      : undefined,
  );
  const [rows, [total]] = await withTenant(caller.orgId, async (tx) => [
    await tx
      .select()
      .from(employees)
      .where(where)
      .orderBy(desc(employees.createdAt))
      .limit(limit)
      .offset(offset),
    await tx.select({ n: count() }).from(employees).where(where),
  ]);
  return ok(caller, rows.map(serializeEmployee), { page, limit, total: Number(total.n) });
}
