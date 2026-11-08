import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeForm } from "@/components/employees/employee-form";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { getEmployeeDetail, getReferenceData, listOrgChart } from "@/lib/queries";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("employees:write");
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) notFound();

  const data = await withTenant(ctx.organizationId, async (tx) => ({
    e: await getEmployeeDetail(tx, ctx.organizationId, id.data),
    ref: await getReferenceData(tx, ctx.organizationId),
    people: await listOrgChart(tx, ctx.organizationId),
  }));
  if (!data.e) notFound();
  const e = data.e;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {e.firstName}</h1>
      <Card>
        <CardContent className="pt-5">
          <EmployeeForm
            employeeId={e.id}
            departments={data.ref.departments}
            designations={data.ref.designations}
            managers={data.people
              .filter((p) => p.id !== e.id)
              .map((p) => ({ id: p.id, name: p.name }))}
            initial={{
              employeeCode: e.employeeCode,
              firstName: e.firstName,
              lastName: e.lastName,
              email: e.email,
              phone: e.phone ?? "",
              gender: e.gender ?? "",
              dateOfBirth: e.dateOfBirth ?? "",
              joinDate: e.joinDate,
              probationEndDate: e.probationEndDate ?? "",
              employmentType: e.employmentType,
              departmentId: e.departmentId ?? "",
              designationId: e.designationId ?? "",
              managerId: e.managerId ?? "",
              workState: e.workState ?? "",
              taxRegime: e.taxRegime,
              bankIfsc: e.bankIfsc ?? "",
              bankName: e.bankName ?? "",
              uan: e.uan ?? "",
              esiNumber: e.esiNumber ?? "",
              panMasked: e.panMasked,
              aadhaarMasked: e.aadhaarMasked,
              bankAccountMasked: e.bankAccountMasked,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
