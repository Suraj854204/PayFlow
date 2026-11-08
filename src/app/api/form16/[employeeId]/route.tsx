import { renderToBuffer } from "@react-pdf/renderer";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { decrypt, maskValue } from "@/lib/crypto";
import { withTenant } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { loadReportItems } from "@/lib/compliance/load";
import { Form16Document, type Form16Data } from "@/lib/compliance/form16-document";
import { form16Summary, type Form16Month } from "@/lib/compliance/reports";
import { employees, organizations } from "@/lib/db/schema";
import { addMonths } from "@/lib/payroll/period";
import { gatherExtras, salaryAt } from "@/lib/payroll/service";
import type { Regime } from "@/lib/payroll/tax";
import { can } from "@/lib/rbac";
import { uuid } from "@/lib/validation/hr";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { employeeId } = await params;
  const fy = Number(new URL(req.url).searchParams.get("fy"));
  if (!uuid.safeParse(employeeId).success || !Number.isInteger(fy) || fy < 2000 || fy > 2100)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const admin = can(ctx.role, "tax:manage") || can(ctx.role, "payroll:process");
  const own = can(ctx.role, "tax:read_own") && ctx.employeeId === employeeId;
  if (!admin && !own) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const [emp] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, ctx.organizationId)));
    if (!emp) return null;
    const [org] = await tx
      .select({ name: organizations.name, tan: organizations.tan })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    const months: Form16Month[] = [];
    for (let i = 0; i < 12; i++) {
      const m = addMonths(`${fy}-04`, i);
      const it = (await loadReportItems(tx, ctx.organizationId, m)).find(
        (x) => x.employeeId === employeeId,
      );
      if (!it) continue;
      const amt = (c: string) => it.deductions.find((l) => l.code === c)?.amount ?? 0;
      months.push({
        month: m,
        gross: it.gross,
        taxable: it.taxable,
        pf: amt("PF"),
        pt: amt("PT"),
        tds: amt("TDS"),
      });
    }
    if (months.length === 0) return "empty" as const;
    const regime: Regime = emp.taxRegime === "old" ? "old" : "new";
    const sal = await salaryAt(tx, ctx.organizationId, emp.id, months[months.length - 1].month);
    const decl = sal
      ? (await gatherExtras(tx, ctx.organizationId, emp, sal, `${fy + 1}-03`)).declarations
      : undefined;
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "form16.downloaded",
      entityType: "employee",
      entityId: emp.id,
      metadata: { fy },
    });
    const doc: Form16Data = {
      org: { name: org.name, tan: org.tan },
      employee: {
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        code: emp.employeeCode,
        panMasked: emp.panEnc ? maskValue(decrypt(emp.panEnc)) : null,
      },
      fyLabel: `${fy}-${String(fy + 1).slice(2)}`,
      months,
      summary: form16Summary(
        months,
        regime,
        decl ?? { section80C: 0, section80D: 0, hraExemption: 0, otherDeductions: 0 },
      ),
    };
    return doc;
  });
  if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (data === "empty")
    return NextResponse.json({ error: "No processed payroll for that year." }, { status: 404 });
  const buf = await renderToBuffer(<Form16Document d={data} />);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="tax-summary-${fy}-${fy + 1}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
