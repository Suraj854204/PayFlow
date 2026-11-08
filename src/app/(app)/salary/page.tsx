import { SalaryBuilder } from "@/components/salary/salary-builder";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getSalaryLibrary } from "@/lib/queries";

export const metadata = { title: "Salary structures" };

export default async function SalaryPage() {
  const ctx = await requirePagePermission("salary:read");
  const lib = await withTenant(ctx.organizationId, (tx) =>
    getSalaryLibrary(tx, ctx.organizationId),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Salary structures</h1>
        <p className="text-muted-foreground text-sm">
          Build components and templates, then assign them from each employee&apos;s profile.
        </p>
      </div>
      <SalaryBuilder
        canEdit={can(ctx.role, "salary:write")}
        components={lib.components.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          type: c.type,
          calcType: c.calcType,
          value: c.value,
          isTaxable: c.isTaxable,
          isPfWage: c.isPfWage,
          isSystem: c.isSystem,
        }))}
        structures={lib.structures.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          componentIds: s.lines.map((l) => l.componentId),
        }))}
      />
    </div>
  );
}
