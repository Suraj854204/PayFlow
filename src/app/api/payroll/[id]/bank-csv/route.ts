import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { decrypt } from "@/lib/crypto";
import { withTenant } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { employees, payments, payrollRuns } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { csvSafe, uuid } from "@/lib/validation/hr";

export const runtime = "nodejs";

/** Bank upload file for the run: one row per payable employee. Needs payroll:process (Finance). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "payroll:process"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!uuid.safeParse(id).success)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const out = await withTenant(ctx.organizationId, async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, ctx.organizationId)));
    if (!run) return null;
    if (!["approved", "processing", "paid"].includes(run.status)) return "notready" as const;
    const rows = await tx
      .select({ p: payments, e: employees })
      .from(payments)
      .innerJoin(employees, eq(employees.id, payments.employeeId))
      .where(eq(payments.runId, id));
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "payroll_run.bank_file_exported",
      entityType: "payroll_run",
      entityId: id,
      metadata: { rows: rows.length },
    });
    return { run, rows };
  });
  if (out === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (out === "notready")
    return NextResponse.json({ error: "Approve the run first." }, { status: 409 });

  const header = [
    "Beneficiary name",
    "Account number",
    "IFSC",
    "Amount (INR)",
    "Reference",
    "Status",
  ];
  const lines = out.rows.map(({ p, e }) =>
    [
      `${e.firstName} ${e.lastName}`.trim(),
      e.bankAccountEnc ? decrypt(e.bankAccountEnc) : "",
      e.bankIfsc ?? "",
      (p.amount / 100).toFixed(2),
      `SAL-${out.run.month}-${e.employeeCode}`,
      p.status,
    ]
      .map(csvSafe)
      .join(","),
  );
  return new NextResponse([header.join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payroll-${out.run.month}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
