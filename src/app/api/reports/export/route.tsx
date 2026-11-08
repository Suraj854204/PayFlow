import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { organizations } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { buildWorkbook, ReportsPdf } from "@/lib/reports/documents";
import { loadReports } from "@/lib/reports/load";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "reports:read"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const format = new URL(req.url).searchParams.get("format");
  if (format !== "xlsx" && format !== "pdf")
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const endMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  const { r, name } = await withTenant(ctx.organizationId, async (tx) => {
    const r = await loadReports(tx, ctx.organizationId, endMonth);
    const [o] = await tx
      .select({ n: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "reports.exported",
      entityType: "report",
      entityId: format,
    });
    return { r, name: o.n };
  });
  if (format === "xlsx") {
    const buf = await buildWorkbook(r, name);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="payroll-reports.xlsx"',
        "cache-control": "private, no-store",
      },
    });
  }
  const buf = await renderToBuffer(<ReportsPdf r={r} orgName={name} />);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="payroll-reports.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
