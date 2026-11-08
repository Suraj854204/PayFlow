import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { formatINR, formatINRCompact } from "@/lib/money";
import { monthLabel } from "@/lib/payroll/period";
import { loadReports } from "@/lib/reports/load";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const PALETTE = [
  "#6366f1",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
  "#84cc16",
  "#ec4899",
];

function Bars({
  rows,
  format,
}: {
  rows: { label: string; value: number }[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" role="list">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="bg-muted h-3 overflow-hidden rounded-full" aria-hidden>
            <span
              className="bg-primary block h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ReportsPage() {
  const ctx = await requirePagePermission("reports:read");
  const endMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  const r = await withTenant(ctx.organizationId, (tx) =>
    loadReports(tx, ctx.organizationId, endMonth),
  );
  if (!r) redirect("/dashboard");
  const latest = r.trend[r.trend.length - 1];
  const head = r.headcount[r.headcount.length - 1];
  let acc = 0;
  const stops = r.departments.map((d, i) => {
    const from = acc;
    acc += d.share * 100;
    return `${PALETTE[i % PALETTE.length]} ${from}% ${acc}%`;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">
            Last 12 months, from approved payroll runs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/api/reports/export?format=xlsx">
              <Download /> Excel
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/reports/export?format=pdf">
              <Download /> PDF
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Latest payroll cost", latest ? formatINR(latest.employerCost) : "—"],
          ["Headcount", String(head?.headcount ?? 0)],
          ["Attrition (annualised)", `${r.attrition}%`],
          ["Months of data", String(r.trend.length)],
        ].map(([l, v]) => (
          <Card key={l}>
            <CardContent className="pt-5">
              <p className="text-muted-foreground text-xs">{l}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payroll cost trend</CardTitle>
          <CardDescription>Employer cost per month.</CardDescription>
        </CardHeader>
        <CardContent>
          {r.trend.length ? (
            <Bars
              rows={r.trend.map((t) => ({
                label: monthLabel(t.month).slice(0, 8),
                value: t.employerCost,
              }))}
              format={formatINRCompact}
            />
          ) : (
            <p className="text-muted-foreground text-sm">No approved payroll runs yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Department cost</CardTitle>
            <CardDescription>Share of the latest month.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-6">
            {r.departments.length ? (
              <>
                <div
                  role="img"
                  aria-label="Department cost share"
                  className="size-32 shrink-0 rounded-full"
                  style={{
                    background: `conic-gradient(${stops.join(", ")})`,
                    mask: "radial-gradient(circle, transparent 42%, #000 43%)",
                    WebkitMask: "radial-gradient(circle, transparent 42%, #000 43%)",
                  }}
                />
                <ul className="space-y-1 text-sm">
                  {r.departments.map((d, i) => (
                    <li key={d.department} className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-sm"
                        style={{ background: PALETTE[i % PALETTE.length] }}
                      />
                      {d.department}: {formatINRCompact(d.cost)} ({Math.round(d.share * 100)}%)
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Headcount</CardTitle>
            <CardDescription>At the end of each month, with joiners and leavers.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="py-1 pr-3 font-medium">Month</th>
                  <th className="py-1 pr-3 font-medium">Headcount</th>
                  <th className="py-1 pr-3 font-medium">Joined</th>
                  <th className="py-1 font-medium">Left</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.headcount.map((h) => (
                  <tr key={h.month}>
                    <td className="py-1.5 pr-3">{h.month}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{h.headcount}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{h.joined}</td>
                    <td className="py-1.5 tabular-nums">{h.exited}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overtime</CardTitle>
          </CardHeader>
          <CardContent>
            {r.overtime.length ? (
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="py-1 font-medium">Month</th>
                    <th className="py-1 font-medium">Hours</th>
                    <th className="py-1 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {r.overtime.map((o) => (
                    <tr key={o.month}>
                      <td className="py-1.5">{o.month}</td>
                      <td className="py-1.5 tabular-nums">{(o.minutes / 60).toFixed(1)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatINR(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Year over year</CardTitle>
            <CardDescription>Same month last year.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.yoy.length ? (
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="py-1 font-medium">Month</th>
                    <th className="py-1 text-right font-medium">This year</th>
                    <th className="py-1 text-right font-medium">Last year</th>
                    <th className="py-1 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {r.yoy.map((y) => (
                    <tr key={y.month}>
                      <td className="py-1.5">{y.month}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatINRCompact(y.current)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {y.previous === null ? "—" : formatINRCompact(y.previous)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {y.changePct === null ? "—" : `${y.changePct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
