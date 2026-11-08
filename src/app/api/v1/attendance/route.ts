import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { authenticate, isResponse, ok, paging } from "@/lib/api/auth";
import { serializeAttendance } from "@/lib/api/serialize";
import { withTenant } from "@/lib/db";
import { attendanceRecords } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const caller = await authenticate(req, "attendance:read");
  if (isResponse(caller)) return caller;
  const url = new URL(req.url);
  const { limit, page, offset } = paging(url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const emp = url.searchParams.get("employeeId");
  const where = and(
    eq(attendanceRecords.organizationId, caller.orgId),
    from && DATE.test(from) ? gte(attendanceRecords.date, from) : undefined,
    to && DATE.test(to) ? lte(attendanceRecords.date, to) : undefined,
    emp && /^[0-9a-f-]{36}$/i.test(emp) ? eq(attendanceRecords.employeeId, emp) : undefined,
  );
  const [rows, [total]] = await withTenant(caller.orgId, async (tx) => [
    await tx
      .select()
      .from(attendanceRecords)
      .where(where)
      .orderBy(desc(attendanceRecords.date))
      .limit(limit)
      .offset(offset),
    await tx.select({ n: count() }).from(attendanceRecords).where(where),
  ]);
  return ok(caller, rows.map(serializeAttendance), { page, limit, total: Number(total.n) });
}
