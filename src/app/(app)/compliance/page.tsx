import { and, asc, eq, gte, lte } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileForm } from "@/components/compliance/file-form";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { complianceItems } from "@/lib/db/schema";
import { KIND_LABEL, dueState, type ComplianceKind } from "@/lib/compliance/calendar";
import { loadReportItems, monthsWithRuns } from "@/lib/compliance/load";
import { ensureCalendar, sendComplianceReminders } from "@/lib/compliance/reminders";
import { expectedDues } from "@/lib/compliance/reports";
import { formatINR } from "@/lib/money";
import { addMonths, monthLabel } from "@/lib/payroll/period";
import { can } from "@/lib/rbac";

export const metadata = { title: "Compliance" };
export const dynamic = "force-dynamic";

const TONE = {
  filed: "success",
  overdue: "danger",
  due_soon: "warning",
  upcoming: "neutral",
} as const;
const LABEL = {
  filed: "Filed",
  overdue: "Overdue",
  due_soon: "Due soon",
  upcoming: "Upcoming",
} as const;

export default async function CompliancePage() {
  const ctx = await requireContext();
  if (!can(ctx.role, "tax:manage") && !can(ctx.role, "payroll:process"))
    redirect("/dashboard?denied=1");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const data = await withTenant(ctx.organizationId, async (tx) => {
    await ensureCalendar(tx, ctx.organizationId, month);
    await sendComplianceReminders(tx, ctx.organizationId, today);
    const items = await tx
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.organizationId, ctx.organizationId),
          gte(complianceItems.period, addMonths(month, -2)),
          lte(complianceItems.period, addMonths(month, 6)),
        ),
      )
      .orderBy(asc(complianceItems.dueDate), asc(complianceItems.kind));
    const runMonths = await monthsWithRuns(tx, ctx.organizationId);
    const expected = new Map<string, ReturnType<typeof expectedDues>>();
    for (const m of runMonths.slice(-6))
      expected.set(m, expectedDues(await loadReportItems(tx, ctx.organizationId, m)));
    return { items, runMonths, expected };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
        <p className="text-muted-foreground text-sm">
          Due dates follow the standard statutory calendar. Professional Tax dates differ by state,
          so confirm yours.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Statutory returns and payments</CardTitle>
          <CardDescription>
            Reminders appear in your notifications from 7 days before the due date.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 pr-4 font-medium">Obligation</th>
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Due</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 text-right font-medium">Expected</th>
                <th className="py-2 font-medium">Challan</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((it) => {
                const st = dueState(it, today);
                const exp =
                  it.kind in { PF: 1, ESI: 1, PT: 1, TDS: 1 }
                    ? data.expected.get(it.period)?.[it.kind as "PF" | "ESI" | "PT" | "TDS"]
                    : undefined;
                return (
                  <tr key={it.id}>
                    <td className="py-2.5 pr-4">
                      {KIND_LABEL[it.kind as ComplianceKind] ?? it.kind}
                    </td>
                    <td className="py-2.5 pr-4">{it.period}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{it.dueDate}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={TONE[st]}>{LABEL[st]}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {exp !== undefined ? formatINR(exp) : "—"}
                    </td>
                    <td className="py-2.5">
                      {it.status === "filed" ? (
                        <span className="text-xs">
                          {it.challanNo} · {formatINR(it.amountPaid ?? 0)} on {it.paidOn}
                        </span>
                      ) : (
                        <FileForm id={it.id} expected={exp ?? 0} today={today} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>
            Built from approved payroll runs. Files with missing UAN, ESI or PAN numbers are still
            produced; fix those on the employee record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.runMonths.length === 0 && (
            <p className="text-muted-foreground text-sm">No approved payroll runs yet.</p>
          )}
          {data.runMonths
            .slice()
            .reverse()
            .map((m) => (
              <div key={m} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-32 font-medium">{monthLabel(m)}</span>
                {(["pf", "esi", "pt", "tds"] as const).map((k) => (
                  <Button key={k} size="sm" variant="outline" asChild>
                    <a href={`/api/compliance/${k}?month=${m}`}>
                      <Download /> {k.toUpperCase()}
                    </a>
                  </Button>
                ))}
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
