import { renderToBuffer } from "@react-pdf/renderer";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { decrypt, maskValue } from "@/lib/crypto";
import { withTenant } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  departments,
  designations,
  employees,
  organizations,
  payrollItems,
  payslips,
} from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { monthLabel } from "@/lib/payroll/period";
import { PayslipDocument, type PayslipData } from "@/lib/payslip/document";
import { uuid } from "@/lib/validation/hr";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!uuid.safeParse(id).success)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const [slip] = await tx
      .select()
      .from(payslips)
      .where(and(eq(payslips.id, id), eq(payslips.organizationId, ctx.organizationId)));
    if (!slip) return null;
    const all = can(ctx.role, "payslips:read_all");
    const own = can(ctx.role, "payslips:read_own") && ctx.employeeId === slip.employeeId;
    if (!all && !own) return "forbidden" as const;

    const [item] = await tx.select().from(payrollItems).where(eq(payrollItems.id, slip.itemId));
    const [emp] = await tx.select().from(employees).where(eq(employees.id, slip.employeeId));
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    const [dept] = emp.departmentId
      ? await tx.select().from(departments).where(eq(departments.id, emp.departmentId))
      : [];
    const [desig] = emp.designationId
      ? await tx.select().from(designations).where(eq(designations.id, emp.designationId))
      : [];
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "payslip.downloaded",
      entityType: "payslip",
      entityId: slip.id,
    });
    const doc: PayslipData = {
      number: slip.number,
      monthLabel: monthLabel(slip.month),
      org: { name: org.name, brandColor: org.brandColor },
      employee: {
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        code: emp.employeeCode,
        designation: desig?.title,
        department: dept?.name,
        joinDate: emp.joinDate,
        panMasked: emp.panEnc ? maskValue(decrypt(emp.panEnc)) : null,
        bankMasked: emp.bankAccountEnc ? maskValue(decrypt(emp.bankAccountEnc)) : null,
        uan: emp.uan,
      },
      paidDays: item.paidDays,
      daysInMonth: new Date(
        Number(slip.month.slice(0, 4)),
        Number(slip.month.slice(5)),
        0,
      ).getDate(),
      lopDays: item.lopDays,
      earnings: item.earnings,
      deductions: item.deductions,
      gross: item.gross,
      totalDeductions: item.totalDeductions,
      net: item.net,
    };
    return doc;
  });

  if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (data === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const buf = await renderToBuffer(<PayslipDocument d={data} />);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${data.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
