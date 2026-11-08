import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DecideClaim, SubmitForm } from "@/components/expenses/expense-panels";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expenses";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees, expenseClaims } from "@/lib/db/schema";
import { formatINR } from "@/lib/money";
import { can } from "@/lib/rbac";

export const metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";

const TONE = {
  submitted: "warning",
  approved: "primary",
  rejected: "danger",
  paid: "success",
} as const;

export default async function ExpensesPage() {
  const ctx = await requireContext();
  const submit = can(ctx.role, "expenses:submit") && Boolean(ctx.employeeId);
  const approve = can(ctx.role, "expenses:approve");
  if (!submit && !approve) redirect("/dashboard?denied=1");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const rows = await tx
      .select({
        c: {
          id: expenseClaims.id,
          employeeId: expenseClaims.employeeId,
          category: expenseClaims.category,
          description: expenseClaims.description,
          amount: expenseClaims.amount,
          date: expenseClaims.expenseDate,
          status: expenseClaims.status,
          hasReceipt: expenseClaims.receiptName,
          note: expenseClaims.decisionNote,
        },
        e: employees,
      })
      .from(expenseClaims)
      .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .where(eq(expenseClaims.organizationId, ctx.organizationId))
      .orderBy(desc(expenseClaims.createdAt))
      .limit(300);
    const orgWide = can(ctx.role, "payroll:read");
    const mine = rows.filter((r) => r.c.employeeId === ctx.employeeId);
    const queue = rows.filter(
      (r) =>
        r.c.status === "submitted" &&
        r.c.employeeId !== ctx.employeeId &&
        (orgWide || (r.e.managerId && r.e.managerId === ctx.employeeId)),
    );
    return { mine, queue };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
      {submit && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>New claim</CardTitle>
              <CardDescription>
                Approved claims are paid as a tax-free reimbursement in the next payroll run. A
                receipt is needed above Rs 500.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubmitForm categories={EXPENSE_CATEGORIES} today={today} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>My claims</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {data.mine.map(({ c }) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {c.category} · {formatINR(c.amount)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {c.date}
                      {c.description ? ` · ${c.description}` : ""}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.hasReceipt && (
                      <a
                        className="text-primary text-xs underline"
                        href={`/api/expenses/${c.id}/receipt`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Receipt
                      </a>
                    )}
                    <Badge tone={TONE[c.status]}>{c.status}</Badge>
                  </div>
                </div>
              ))}
              {data.mine.length === 0 && (
                <p className="text-muted-foreground py-6 text-center text-sm">No claims yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {approve && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting approval</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {data.queue.map(({ c, e }) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {e.firstName} {e.lastName}: {c.category}, {formatINR(c.amount)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {c.date}
                    {c.description ? ` · ${c.description}` : ""}
                    {c.hasReceipt ? "" : " · no receipt"}
                  </p>
                  {c.hasReceipt && (
                    <a
                      className="text-primary text-xs underline"
                      href={`/api/expenses/${c.id}/receipt`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View receipt
                    </a>
                  )}
                </div>
                <DecideClaim id={c.id} />
              </div>
            ))}
            {data.queue.length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm">Nothing waiting.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
