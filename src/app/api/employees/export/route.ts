import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getContext } from "@/lib/auth/context";
import { can } from "@/lib/rbac";
import { withTenant } from "@/lib/db";
import { departments, designations, employees } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { csvSafe } from "@/lib/validation/hr";

export const dynamic = "force-dynamic";

const HEADERS = [
  "employee_code",
  "first_name",
  "last_name",
  "email",
  "phone",
  "status",
  "employment_type",
  "join_date",
  "probation_end_date",
  "exit_date",
  "department",
  "designation",
  "work_state",
];

/** Export never includes PAN, Aadhaar or bank account numbers. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "employees:read"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await withTenant(ctx.organizationId, async (tx) => {
    const data = await tx
      .select({
        e: employees,
        department: departments.name,
        designation: designations.title,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(and(eq(employees.organizationId, ctx.organizationId), isNull(employees.deletedAt)))
      .orderBy(asc(employees.employeeCode));
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "employee.exported",
      entityType: "employee",
      newValues: { count: data.length },
    });
    return data;
  });

  const lines = [HEADERS.join(",")];
  for (const { e, department, designation } of rows) {
    lines.push(
      [
        e.employeeCode,
        e.firstName,
        e.lastName,
        e.email,
        e.phone,
        e.status,
        e.employmentType,
        e.joinDate,
        e.probationEndDate,
        e.exitDate,
        department,
        designation,
        e.workState,
      ]
        .map(csvSafe)
        .join(","),
    );
  }
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
