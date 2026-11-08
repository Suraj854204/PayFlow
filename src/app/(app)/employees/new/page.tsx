import { Card, CardContent } from "@/components/ui/card";
import { EmployeeForm } from "@/components/employees/employee-form";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { getReferenceData, listOrgChart } from "@/lib/queries";

export const metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const ctx = await requirePagePermission("employees:write");
  const { ref, people } = await withTenant(ctx.organizationId, async (tx) => ({
    ref: await getReferenceData(tx, ctx.organizationId),
    people: await listOrgChart(tx, ctx.organizationId),
  }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New employee</h1>
      <Card>
        <CardContent className="pt-5">
          <EmployeeForm
            departments={ref.departments}
            designations={ref.designations}
            managers={people.map((p) => ({ id: p.id, name: p.name }))}
            initial={{
              employeeCode: "",
              firstName: "",
              lastName: "",
              email: "",
              phone: "",
              gender: "",
              dateOfBirth: "",
              joinDate: today,
              probationEndDate: "",
              employmentType: "full_time",
              departmentId: "",
              designationId: "",
              managerId: "",
              workState: "",
              taxRegime: "new",
              bankIfsc: "",
              bankName: "",
              uan: "",
              esiNumber: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
