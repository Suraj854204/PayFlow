import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BenchmarkForm } from "@/components/analytics/benchmark-form";
import { ForecastPlanner } from "@/components/analytics/forecast-planner";
import { CompareBars } from "@/components/charts/compare-bars";
import { loadFlags } from "@/lib/enterprise/flags-server";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { scoreAttrition } from "@/lib/analytics/attrition";
import { equityReport, MIN_GROUP, positionInRange } from "@/lib/analytics/equity";
import { loadAnalytics } from "@/lib/analytics/load";
import { formatINR, formatINRCompact } from "@/lib/money";
import { can } from "@/lib/rbac";

export const metadata = { title: "People analytics" };
export const dynamic = "force-dynamic";

type Tab = "forecast" | "attrition" | "equity" | "benchmarks";
const TAB_LABEL: Record<Tab, string> = {
  forecast: "Cost forecast",
  attrition: "Attrition risk",
  equity: "Pay equity",
  benchmarks: "Benchmarks",
};
const BAND_TONE = { high: "danger", medium: "warning", low: "success" } as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireContext();
  const allowed: Tab[] = [];
  if (can(ctx.role, "payroll:read")) allowed.push("forecast");
  if (can(ctx.role, "employees:read") || can(ctx.role, "employees:read_team"))
    allowed.push("attrition");
  if (can(ctx.role, "salary:read")) allowed.push("equity", "benchmarks");
  if (allowed.length === 0) redirect("/dashboard?denied=1");
  const flags = await withTenant(ctx.organizationId, (tx) => loadFlags(tx, ctx.organizationId));
  if (!flags.equity) allowed.splice(0, allowed.length, ...allowed.filter((t) => t !== "equity"));
  const { tab: raw } = await searchParams;
  const tab = (allowed.includes(raw as Tab) ? raw : allowed[0]) as Tab;
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const data = await withTenant(ctx.organizationId, (tx) =>
    loadAnalytics(tx, ctx.organizationId, today),
  );

  // Managers see only their own direct reports; HR and Finance see everyone.
  const wholeCompany = can(ctx.role, "employees:read");
  const scope = wholeCompany
    ? data.people
    : data.people.filter((p) => p.managerId && p.managerId === ctx.employeeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People analytics</h1>
        <p className="text-muted-foreground text-sm">
          Forecasts and signals to plan with. They start conversations; they never decide anything
          about a person.
        </p>
      </div>
      <nav aria-label="Analytics sections" className="flex flex-wrap gap-2">
        {allowed.map((t) => (
          <Link
            key={t}
            href={`/analytics?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${t === tab ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {tab === "forecast" &&
        (data.lastRun ? (
          <ForecastPlanner
            fromMonth={data.lastRun.month}
            baselineMonthlyCost={data.lastRun.employerCost}
            headcount={data.lastRun.employees}
            suggestedAttritionPct={12}
          />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground p-6 text-sm">
              The forecast starts from a real payroll run. Approve a run first.
            </CardContent>
          </Card>
        ))}

      {tab === "attrition" && (
        <Attrition people={scope} moodByDept={data.moodByDept} today={today} whole={wholeCompany} />
      )}

      {tab === "equity" && <Equity people={data.people} />}

      {tab === "benchmarks" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Market ranges</CardTitle>
              <CardDescription>
                PayFlow does not ship market data. Enter ranges you trust and tell us the source.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BenchmarkForm designations={data.designationTitles} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How your pay compares</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.benchmarks.size === 0 && (
                <p className="text-muted-foreground text-sm">No ranges entered yet.</p>
              )}
              {[...data.benchmarks.entries()].map(([desId, b]) => {
                const group = data.people.filter((p) => p.role === desId);
                const below = group.filter(
                  (p) => positionInRange(p.ctcAnnual, b).band === "below",
                ).length;
                const above = group.filter(
                  (p) => positionInRange(p.ctcAnnual, b).band === "above",
                ).length;
                const med = group.length
                  ? [...group].sort((a, c) => a.ctcAnnual - c.ctcAnnual)[
                      Math.floor(group.length / 2)
                    ].ctcAnnual
                  : null;
                return (
                  <div key={desId} className="rounded-xl border p-3">
                    <p className="font-medium">{b.title}</p>
                    <p className="text-muted-foreground text-xs">
                      Market {formatINRCompact(b.p25)} / {formatINRCompact(b.p50)} /{" "}
                      {formatINRCompact(b.p75)} · {b.source}, as of {b.asOf}
                    </p>
                    {group.length === 0 ? (
                      <p className="mt-2 text-sm">Nobody in this role yet.</p>
                    ) : (
                      <p className="mt-2 text-sm">
                        {group.length} people. Median {formatINRCompact(med!)} (
                        {positionInRange(med!, b).compaRatio}× market median). {below} below the
                        25th percentile, {above} above the 75th.
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Attrition({
  people,
  moodByDept,
  today,
  whole,
}: {
  people: Awaited<ReturnType<typeof loadAnalytics>>["people"];
  moodByDept: Awaited<ReturnType<typeof loadAnalytics>>["moodByDept"];
  today: string;
  whole: boolean;
}) {
  // Peer pay comparisons must use the whole company even when the viewer only sees their team.
  const results = scoreAttrition(people, today, moodByDept).sort((a, b) => b.score - a.score);
  const counts = {
    high: results.filter((r) => r.band === "high").length,
    medium: results.filter((r) => r.band === "medium").length,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{whole ? "Retention signals" : "Your team's retention signals"}</CardTitle>
        <CardDescription>
          {counts.high} high, {counts.medium} medium. A rule-based score from tenure, pay revisions,
          pay versus peers, absences, overtime and team sentiment. Every point is explained, and it
          is not a trained model.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {results.length === 0 && (
          <p className="text-muted-foreground py-2 text-sm">No one to show.</p>
        )}
        {results.map((r) => (
          <details key={r.id} className="py-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 font-medium">{r.name}</span>
              <span className="text-muted-foreground text-sm tabular-nums">{r.score}/100</span>
              <Badge tone={BAND_TONE[r.band]}>{r.band}</Badge>
            </summary>
            <ul className="text-muted-foreground mt-2 space-y-1 pl-4 text-sm">
              {r.factors.length === 0 && <li>No risk factors found.</li>}
              {r.factors.map((f) => (
                <li key={f.key} className="list-disc">
                  <span className="text-foreground font-medium">{f.label}</span> (+{f.points}):{" "}
                  {f.detail}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

function Equity({ people }: { people: Awaited<ReturnType<typeof loadAnalytics>>["people"] }) {
  const r = equityReport(people);
  const fmtGap = (g: number | null) => (g === null ? "Not enough people" : `${g}%`);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-muted-foreground text-xs font-medium">Overall median gap</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="gap-overall">
              {fmtGap(r.unadjustedGapPercent)}
            </p>
            <p className="text-muted-foreground text-xs">
              Everyone together. Can reflect who does which jobs, not only pay for the same job.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-muted-foreground text-xs font-medium">Like-for-like gap</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="gap-adjusted">
              {fmtGap(r.adjustedGapPercent)}
            </p>
            <p className="text-muted-foreground text-xs">
              Within the same designation. Positive means women are paid less.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>By role</CardTitle>
          <CardDescription>
            Shown only where both groups have at least {MIN_GROUP} people
            {r.suppressedRoles
              ? ` (${r.suppressedRoles} role${r.suppressedRoles === 1 ? "" : "s"} hidden)`
              : ""}
            , so no individual can be identified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {r.roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No role has enough people in both groups yet.
            </p>
          ) : (
            <CompareBars
              ariaLabel="Median yearly CTC by role and gender"
              format="inrCompact"
              rows={r.roles.map((g) => ({
                label: `${g.label} (${g.gapPercent}% gap, ${g.men} men, ${g.women} women)`,
                values: [
                  { name: "Men", value: g.menMedian, tone: "muted" as const },
                  { name: "Women", value: g.womenMedian, tone: "primary" as const },
                ],
              }))}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Women in each pay quartile</CardTitle>
          <CardDescription>
            Bottom to top. Roughly equal shares across quartiles suggest balanced progression.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompareBars
            ariaLabel="Share of women by pay quartile"
            format="percent"
            rows={r.womenShareByQuartile.map((s, i) => ({
              label: [
                "Lowest paid quarter",
                "Lower middle",
                "Upper middle",
                "Highest paid quarter",
              ][i],
              values: [
                {
                  name: "Women",
                  value: s ?? 0,
                  tone: s === null ? ("muted" as const) : ("primary" as const),
                },
              ],
            }))}
          />
          <p className="text-muted-foreground mt-3 text-xs">
            {r.counts.men} men, {r.counts.women} women, {r.counts.other} other, {r.counts.unknown}{" "}
            not recorded. Total CTC across {formatINR(people.reduce((s, p) => s + p.ctcAnnual, 0))}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
