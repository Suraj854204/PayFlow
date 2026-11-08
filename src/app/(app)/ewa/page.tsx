import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelButton, DecideButtons, RequestForm, SettingsForm } from "@/components/ewa/panels";
import { requireFlagOn } from "@/lib/enterprise/flags-server";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees, ewaRequests } from "@/lib/db/schema";
import { availableAdvance, DEFAULT_EWA_POLICY } from "@/lib/ewa/rules";
import { loadFacts, loadPolicy } from "@/lib/ewa/service";
import { formatINR } from "@/lib/money";
import { currentMonthIst } from "@/lib/payroll/run-core";
import { can } from "@/lib/rbac";

export const metadata = { title: "Earned wage access" };
export const dynamic = "force-dynamic";

const TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;
const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export default async function EwaPage() {
  const ctx = await requireContext();
  await withTenant(ctx.organizationId, (tx) => requireFlagOn(tx, ctx.organizationId, "ewa"));
  const request = can(ctx.role, "ewa:request") && Boolean(ctx.employeeId);
  const manage = can(ctx.role, "ewa:manage");
  if (!request && !manage) redirect("/dashboard?denied=1");
  const month = currentMonthIst();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

  const d = await withTenant(ctx.organizationId, async (tx) => {
    const policy = await loadPolicy(tx, ctx.organizationId);
    const facts =
      request && ctx.employeeId
        ? await loadFacts(tx, ctx.organizationId, ctx.employeeId, month, today)
        : null;
    const mine =
      request && ctx.employeeId
        ? await tx
            .select()
            .from(ewaRequests)
            .where(eq(ewaRequests.employeeId, ctx.employeeId))
            .orderBy(desc(ewaRequests.createdAt))
            .limit(10)
        : [];
    const pending = manage
      ? await tx
          .select({ r: ewaRequests, first: employees.firstName, last: employees.lastName })
          .from(ewaRequests)
          .innerJoin(employees, eq(employees.id, ewaRequests.employeeId))
          .where(
            and(
              eq(ewaRequests.organizationId, ctx.organizationId),
              eq(ewaRequests.status, "pending"),
            ),
          )
          .orderBy(desc(ewaRequests.createdAt))
      : [];
    return { policy, facts, mine, pending };
  });
  const available = d.facts && d.policy.enabled ? availableAdvance(d.facts, d.policy) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Earned wage access</h1>
        <p className="text-muted-foreground text-sm">
          Draw part of the salary you have already earned this month. It is deducted from your next
          payroll.
        </p>
      </div>
      <p className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2 text-sm">
        Demo mode: approving an advance records it and schedules the deduction, but no money is
        actually transferred.
      </p>

      {request && (
        <Card>
          <CardHeader>
            <CardTitle>Your advance</CardTitle>
            <CardDescription>
              {!d.policy.enabled
                ? "Your company has not turned this on."
                : d.facts
                  ? `Earned so far this month: ${formatINR(d.facts.earnedSoFar)}. You can draw up to ${d.policy.maxPercent}% of it.`
                  : "Your salary has not been set up yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {d.policy.enabled && d.facts && (
              <>
                <p className="text-3xl font-semibold tabular-nums" data-testid="ewa-available">
                  {formatINR(available)}
                </p>
                <p className="text-muted-foreground text-xs">
                  available now. Requests up to {formatINR(d.policy.autoApproveLimit)} are approved
                  straight away; larger ones need a person to approve.
                </p>
                <RequestForm available={available} min={DEFAULT_EWA_POLICY.minAmount} />
              </>
            )}
            <div className="divide-y">
              {d.mine.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="flex-1">
                    {formatINR(r.amount)}{" "}
                    <span className="text-muted-foreground">· {fmt.format(r.createdAt)}</span>
                  </span>
                  <Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>
                  {r.status === "pending" && <CancelButton id={r.id} />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {manage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Waiting for approval</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {d.pending.length === 0 && (
                <p className="text-muted-foreground py-2 text-sm">Nothing waiting.</p>
              )}
              {d.pending.map(({ r, first, last }) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex-1">
                    <p className="font-medium">{`${first} ${last}`.trim()}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatINR(r.amount)} requested · earned so far {formatINR(r.earnedAtRequest)}
                    </p>
                  </div>
                  {r.employeeId === ctx.employeeId ? (
                    <span className="text-muted-foreground text-xs">
                      Someone else must decide your own request
                    </span>
                  ) : (
                    <DecideButtons id={r.id} label={`${first} ${last}`.trim()} />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingsForm
                initial={{
                  enabled: d.policy.enabled,
                  maxPercent: d.policy.maxPercent,
                  monthlyCapRupees: d.policy.monthlyCap / 100,
                  autoApproveRupees: d.policy.autoApproveLimit / 100,
                  maxRequestsPerMonth: d.policy.maxRequestsPerMonth,
                }}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
