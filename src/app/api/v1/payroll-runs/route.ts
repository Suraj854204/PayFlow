import { count, desc, eq } from "drizzle-orm";
import { authenticate, isResponse, ok, paging } from "@/lib/api/auth";
import { serializeRun } from "@/lib/api/serialize";
import { withTenant } from "@/lib/db";
import { payrollRuns } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const caller = await authenticate(req, "payroll:read");
  if (isResponse(caller)) return caller;
  const { limit, page, offset } = paging(new URL(req.url));
  const where = eq(payrollRuns.organizationId, caller.orgId);
  const [rows, [total]] = await withTenant(caller.orgId, async (tx) => [
    await tx
      .select()
      .from(payrollRuns)
      .where(where)
      .orderBy(desc(payrollRuns.month))
      .limit(limit)
      .offset(offset),
    await tx.select({ n: count() }).from(payrollRuns).where(where),
  ]);
  return ok(caller, rows.map(serializeRun), { page, limit, total: Number(total.n) });
}
