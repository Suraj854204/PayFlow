import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DeclarationForm,
  ReviewButtons,
  type DeclInit,
} from "@/components/expenses/declaration-form";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees, taxDeclarations } from "@/lib/db/schema";
import { formatINR } from "@/lib/money";
import { computeBreakdownSafe } from "@/lib/tax-view";
import { fyLabel, fyStartYear } from "@/lib/payroll/period";
import { can } from "@/lib/rbac";
import { salaryAt } from "@/lib/payroll/service";
import { NO_DECLARATIONS, SECTION_80D_CAP, compareRegimes, hraExemption } from "@/lib/payroll/tax";
import { professionalTax } from "@/lib/payroll/pt";
import { computePf, pfCeiling } from "@/lib/payroll/statutory";

export const metadata = { title: "Tax declarations" };
export const dynamic = "force-dynamic";

export default async function TaxPage() {
  const ctx = await requireContext();
  const own = can(ctx.role, "tax:read_own") && Boolean(ctx.employeeId);
  const manage = can(ctx.role, "tax:manage");
  if (!own && !manage) redirect("/dashboard?denied=1");
  const nowMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  const fy = fyStartYear(nowMonth);

  const data = await withTenant(ctx.organizationId, async (tx) => {
    let mine: DeclInit | null = null;
    let compare: ReturnType<typeof compareRegimes> | null = null;
    let hra = 0;
    if (own && ctx.employeeId) {
      const [d] = await tx
        .select()
        .from(taxDeclarations)
        .where(
          and(eq(taxDeclarations.employeeId, ctx.employeeId), eq(taxDeclarations.fyStart, fy)),
        );
      mine = {
        regime: d?.regime === "old" ? "old" : "new",
        section80C: d?.data.section80C ?? 0,
        section80D: d?.data.section80D ?? 0,
        annualRent: d?.data.annualRent ?? 0,
        metro: d?.data.metro ?? false,
        landlordName: d?.data.landlordName ?? "",
        landlordPan: d?.data.landlordPan ?? "",
        otherDeductions: d?.data.otherDeductions ?? 0,
        status: d?.status ?? "none",
        reviewNote: d?.reviewNote ?? null,
      };
      const [emp] = await tx.select().from(employees).where(eq(employees.id, ctx.employeeId));
      const sal = emp ? await salaryAt(tx, ctx.organizationId, emp.id, nowMonth) : null;
      if (emp && sal) {
        const v = computeBreakdownSafe(sal.breakdown);
        const decl = {
          ...NO_DECLARATIONS,
          section80C: mine.section80C,
          section80D: Math.min(mine.section80D, SECTION_80D_CAP),
          otherDeductions: mine.otherDeductions,
        };
        hra = hraExemption({
          basicAnnual: v.basic * 12,
          hraAnnual: v.hra * 12,
          rentAnnual: mine.annualRent,
          metro: mine.metro,
        });
        const pf = computePf(v.pfWages, pfCeiling(nowMonth)).employee * 12;
        let pt = 0;
        for (let m = 1; m <= 12; m++)
          pt += professionalTax(emp.workState, v.gross, m, emp.gender).tax;
        compare = compareRegimes(v.taxable * 12, pf, pt, { ...decl, hraExemption: hra });
      }
    }
    let queue: {
      id: string;
      who: string;
      regime: string;
      c80: number;
      d80: number;
      rent: number;
    }[] = [];
    if (manage) {
      const rows = await tx
        .select({ d: taxDeclarations, e: employees })
        .from(taxDeclarations)
        .innerJoin(employees, eq(employees.id, taxDeclarations.employeeId))
        .where(
          and(
            eq(taxDeclarations.organizationId, ctx.organizationId),
            eq(taxDeclarations.fyStart, fy),
            eq(taxDeclarations.status, "submitted"),
          ),
        );
      queue = rows.map(({ d, e }) => ({
        id: d.id,
        who: `${e.firstName} ${e.lastName}`.trim(),
        regime: d.regime,
        c80: d.data.section80C,
        d80: d.data.section80D,
        rent: d.data.annualRent,
      }));
    }
    return { mine, compare, hra, queue };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tax declarations</h1>
        <p className="text-muted-foreground text-sm">Financial year {fyLabel(nowMonth)}</p>
      </div>
      {own && data.mine && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                My declaration{" "}
                <Badge
                  tone={
                    data.mine.status === "verified"
                      ? "success"
                      : data.mine.status === "submitted"
                        ? "warning"
                        : data.mine.status === "rejected"
                          ? "danger"
                          : "neutral"
                  }
                >
                  {data.mine.status === "none" ? "not started" : data.mine.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                Your TDS uses the regime and deductions you submit, from the next payroll run.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeclarationForm init={data.mine} />
            </CardContent>
          </Card>
          <p className="text-sm">
            <a className="text-primary underline" href={`/api/form16/${ctx.employeeId}?fy=${fy}`}>
              Download my annual tax summary (Form 16 style) for FY {fyLabel(nowMonth)}
            </a>
          </p>
          {data.compare && (
            <Card>
              <CardHeader>
                <CardTitle>Which regime is better for you?</CardTitle>
                <CardDescription>
                  An estimate from your current salary and the deductions above (HRA exemption{" "}
                  {formatINR(data.hra)}).
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground text-xs">New regime tax</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatINR(data.compare.newTax)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Old regime tax</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatINR(data.compare.oldTax)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Better for you</p>
                  <p className="text-xl font-semibold">
                    {data.compare.better === "new" ? "New" : "Old"} regime{" "}
                    <span className="text-muted-foreground text-sm font-normal">
                      saves {formatINR(data.compare.saving)} a year
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {manage && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting verification</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {data.queue.map((q) => (
              <div
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {q.who} · {q.regime} regime
                  </p>
                  <p className="text-muted-foreground text-xs">
                    80C {formatINR(q.c80)} · 80D {formatINR(q.d80)} · Rent {formatINR(q.rent)}
                  </p>
                </div>
                <ReviewButtons id={q.id} />
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
