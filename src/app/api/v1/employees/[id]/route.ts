import { and, eq, isNull } from "drizzle-orm";
import { apiError, authenticate, isResponse, ok } from "@/lib/api/auth";
import { serializeEmployee } from "@/lib/api/serialize";
import { withTenant } from "@/lib/db";
import { employees } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authenticate(req, "employees:read");
  if (isResponse(caller)) return caller;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return apiError(404, "not_found", "Employee not found.", caller.headers);
  const [row] = await withTenant(caller.orgId, (tx) =>
    tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.id, id),
          eq(employees.organizationId, caller.orgId),
          isNull(employees.deletedAt),
        ),
      ),
  );
  return row
    ? ok(caller, serializeEmployee(row))
    : apiError(404, "not_found", "Employee not found.", caller.headers);
}
