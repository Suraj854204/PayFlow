import { and, count, desc, eq } from "drizzle-orm";
import { authenticate, isResponse, ok, paging } from "@/lib/api/auth";
import { serializeLeave } from "@/lib/api/serialize";
import { withTenant } from "@/lib/db";
import { leaveRequests } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const caller = await authenticate(req, "leave:read");
  if (isResponse(caller)) return caller;
  const url = new URL(req.url);
  const { limit, page, offset } = paging(url);
  const status = url.searchParams.get("status");
  const where = and(
    eq(leaveRequests.organizationId, caller.orgId),
    status && ["pending", "approved", "rejected", "cancelled"].includes(status)
      ? eq(leaveRequests.status, status as "pending")
      : undefined,
  );
  const [rows, [total]] = await withTenant(caller.orgId, async (tx) => [
    await tx
      .select()
      .from(leaveRequests)
      .where(where)
      .orderBy(desc(leaveRequests.fromDate))
      .limit(limit)
      .offset(offset),
    await tx.select({ n: count() }).from(leaveRequests).where(where),
  ]);
  return ok(caller, rows.map(serializeLeave), { page, limit, total: Number(total.n) });
}
