import { and, desc, eq, isNull } from "drizzle-orm";
import { Simulator } from "@/components/simulator/simulator";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees, employeeSalaries, fxRates, salaryComponents } from "@/lib/db/schema";
import { currentMonthIst } from "@/lib/payroll/run-core";
import { DEFAULT_COMPONENTS, type SalaryLineInput } from "@/lib/salary";

export const metadata = { title: "What-if simulator" };
export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const ctx = await requireContext();
  const data = await withTenant(ctx.organizationId, async (tx) => {
    const comps = await tx
      .select()
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.organizationId, ctx.organizationId),
          isNull(salaryComponents.deletedAt),
        ),
      )
      .orderBy(salaryComponents.position);
    // Only the caller's own record is ever read here, so every role may use the page.
    const emp = ctx.employeeId
      ? (await tx.select().from(employees).where(eq(employees.id, ctx.employeeId)))[0]
      : undefined;
    const sal = ctx.employeeId
      ? (
          await tx
            .select({ ctc: employeeSalaries.ctcAnnual })
            .from(employeeSalaries)
            .where(eq(employeeSalaries.employeeId, ctx.employeeId))
            .orderBy(desc(employeeSalaries.effectiveFrom))
            .limit(1)
        )[0]
      : undefined;
    const rates = await tx
      .select()
      .from(fxRates)
      .where(eq(fxRates.organizationId, ctx.organizationId));
    return { comps, emp, sal, rates };
  });
  const components: SalaryLineInput[] = data.comps.length
    ? data.comps.map((c) => ({
        code: c.code,
        name: c.name,
        type: c.type,
        calcType: c.calcType,
        value: c.value,
        isTaxable: c.isTaxable,
        isPfWage: c.isPfWage,
      }))
    : DEFAULT_COMPONENTS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">What-if salary simulator</h1>
        <p className="text-muted-foreground text-sm">
          See how a change in CTC turns into take-home, and which tax regime suits you.
        </p>
      </div>
      <Simulator
        initialCtc={data.sal?.ctc ?? 0}
        month={currentMonthIst()}
        workState={data.emp?.workState ?? null}
        gender={(data.emp?.gender as "male" | "female" | "other" | null) ?? null}
        components={components}
        fx={data.rates.map((r) => ({ currency: r.currency, perInr: Number(r.perInr) }))}
      />
    </div>
  );
}
