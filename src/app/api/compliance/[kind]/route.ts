import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { loadReportItems } from "@/lib/compliance/load";
import { esiReport, pfReport, ptReport, tdsReport } from "@/lib/compliance/reports";
import { MONTH_RE } from "@/lib/payroll/period";
import { can } from "@/lib/rbac";

export const runtime = "nodejs";

const REPORTS = { pf: pfReport, esi: esiReport, pt: ptReport, tds: tdsReport } as const;

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "tax:manage") && !can(ctx.role, "payroll:process"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { kind } = await params;
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!(kind in REPORTS) || !MONTH_RE.test(month))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const out = await withTenant(ctx.organizationId, async (tx) => {
    const items = await loadReportItems(tx, ctx.organizationId, month);
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "compliance.report_exported",
      entityType: "compliance_report",
      entityId: `${kind}:${month}`,
      metadata: { rows: items.length },
    });
    return items;
  });
  if (out.length === 0)
    return NextResponse.json({ error: "No approved payroll run for that month." }, { status: 404 });
  const r = REPORTS[kind as keyof typeof REPORTS](out);
  return new NextResponse(r.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${month}.csv"`,
      "x-report-warnings": encodeURIComponent(r.missing.join("; ")),
      "cache-control": "private, no-store",
    },
  });
}
