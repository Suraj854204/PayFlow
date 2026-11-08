import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRunForm } from "@/components/payroll/create-run-form";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { payrollRuns } from "@/lib/db/schema";
import { formatINR } from "@/lib/money";
import { monthLabel } from "@/lib/payroll/period";
import { can } from "@/lib/rbac";
import { RUN_TONE } from "@/components/payroll/status";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const ctx = await requirePagePermission("payroll:read");
  const runs = await withTenant(ctx.organizationId, (tx) =>
    tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.organizationId, ctx.organizationId))
      .orderBy(desc(payrollRuns.month), desc(payrollRuns.createdAt)),
  );
  const now = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
        <p className="text-muted-foreground text-sm">
          Draft, review, approve, process, paid. The person who prepares a run cannot approve it.
        </p>
      </div>

      {can(ctx.role, "payroll:create") && (
        <Card>
          <CardHeader>
            <CardTitle>New run</CardTitle>
            <CardDescription>
              Uses each employee&apos;s salary in force on the last day of the month.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateRunForm defaultMonth={now} maxMonth={now} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 pr-4 font-medium">Month</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Employees</th>
                <th className="py-2 pr-4 text-right font-medium">Net pay</th>
                <th className="py-2 text-right font-medium">Employer cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="py-2.5 pr-4">
                    <Link href={`/payroll/${r.id}`} className="font-medium hover:underline">
                      {monthLabel(r.month)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>
                  </td>
                  <td className="py-2.5 pr-4">{r.employeeCount}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{formatINR(r.totalNet)}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatINR(r.totalEmployerCost)}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground py-10 text-center">
                    No payroll runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
