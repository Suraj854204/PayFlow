import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { employees, expenseClaims } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { uuid } from "@/lib/validation/hr";

export const runtime = "nodejs";

/** The claimant, their manager, and org-wide approvers (Finance/HR/admin) may view a receipt. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!uuid.safeParse(id).success)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const out = await withTenant(ctx.organizationId, async (tx) => {
    const [c] = await tx
      .select()
      .from(expenseClaims)
      .where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, ctx.organizationId)));
    if (!c || !c.receiptData) return null;
    const [emp] = await tx
      .select({ m: employees.managerId })
      .from(employees)
      .where(eq(employees.id, c.employeeId));
    const allowed =
      c.employeeId === ctx.employeeId ||
      (can(ctx.role, "expenses:approve") &&
        (can(ctx.role, "payroll:read") || (emp?.m && emp.m === ctx.employeeId)));
    if (!allowed) return "forbidden" as const;
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "expense.receipt_viewed",
      entityType: "expense",
      entityId: c.id,
    });
    return c;
  });
  if (out === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (out === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return new NextResponse(new Uint8Array(out.receiptData!), {
    headers: {
      "content-type": out.receiptMime ?? "application/octet-stream",
      "content-disposition": `inline; filename="${(out.receiptName ?? "receipt").replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "cache-control": "private, no-store",
    },
  });
}
