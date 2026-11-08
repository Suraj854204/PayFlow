import { desc, eq, and } from "drizzle-orm";
import { Download } from "lucide-react";
import { ExplainButton } from "@/components/payslips/explain-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { payrollItems, payslips } from "@/lib/db/schema";
import { formatINR } from "@/lib/money";
import { can } from "@/lib/rbac";
import { monthLabel } from "@/lib/payroll/period";

export const metadata = { title: "My payslips" };
export const dynamic = "force-dynamic";

export default async function PayslipsPage() {
  const ctx = await requirePagePermission("payslips:read_own");
  const rows = ctx.employeeId
    ? await withTenant(ctx.organizationId, (tx) =>
        tx
          .select({
            id: payslips.id,
            month: payslips.month,
            number: payslips.number,
            net: payrollItems.net,
            gross: payrollItems.gross,
          })
          .from(payslips)
          .innerJoin(payrollItems, eq(payrollItems.id, payslips.itemId))
          .where(
            and(
              eq(payslips.organizationId, ctx.organizationId),
              eq(payslips.employeeId, ctx.employeeId!),
            ),
          )
          .orderBy(desc(payslips.month)),
      )
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My payslips</h1>
      <Card>
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
          <CardDescription>
            {ctx.employeeId
              ? "Published after each payroll run is processed."
              : "Your login is not linked to an employee record in this company, so there are no payslips to show."}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <p className="font-medium">{monthLabel(r.month)}</p>
                <p className="text-muted-foreground text-xs">
                  {r.number} · Net {formatINR(r.net)}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {can(ctx.role, "ai:use") && <ExplainButton payslipId={r.id} />}
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/payslips/${r.id}/pdf`}>
                    <Download /> PDF
                  </a>
                </Button>
              </div>
            </div>
          ))}
          {ctx.employeeId && rows.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">No payslips yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
