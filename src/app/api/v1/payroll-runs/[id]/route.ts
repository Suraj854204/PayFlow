import { and, eq } from "drizzle-orm";
import { apiError, authenticate, isResponse, ok } from "@/lib/api/auth";
import { serializeRun } from "@/lib/api/serialize";
import { withTenant } from "@/lib/db";
import { payrollRuns } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authenticate(req, "payroll:read");
  if (isResponse(caller)) return caller;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return apiError(404, "not_found", "Payroll run not found.", caller.headers);
  const [row] = await withTenant(caller.orgId, (tx) =>
    tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, caller.orgId))),
  );
  return row
    ? ok(caller, serializeRun(row))
    : apiError(404, "not_found", "Payroll run not found.", caller.headers);
}
