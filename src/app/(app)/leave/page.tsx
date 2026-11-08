import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyForm, CancelButton, DecideButtons, TypeForm } from "@/components/leave/leave-panels";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees, leaveBalances, leaveRequests, leaveTypes } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { ensureBalances, fyStartOf } from "@/lib/workforce/leave-balance";

export const metadata = { title: "Leave" };
export const dynamic = "force-dynamic";

const TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;

export default async function LeavePage() {
  const ctx = await requireContext();
  const apply = can(ctx.role, "leave:apply") && Boolean(ctx.employeeId);
  const approve = can(ctx.role, "leave:approve");
  const manage = can(ctx.role, "leave:manage");
  if (!apply && !approve && !manage) redirect("/dashboard?denied=1");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const fy = fyStartOf(today);

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const types = await tx
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.organizationId, ctx.organizationId), isNull(leaveTypes.deletedAt)));
    let balances: { name: string; allotted: number; used: number }[] = [];
    let mine: {
      id: string;
      type: string;
      from: string;
      to: string;
      days: string;
      status: keyof typeof TONE;
      note: string | null;
    }[] = [];
    if (apply && ctx.employeeId) {
      const [me] = await tx
        .select({ id: employees.id, joinDate: employees.joinDate })
        .from(employees)
        .where(eq(employees.id, ctx.employeeId));
      if (me) {
        await ensureBalances(tx, ctx.organizationId, me, fy); // idempotent: creates this year's rows on first visit
        const bs = await tx
          .select()
          .from(leaveBalances)
          .where(and(eq(leaveBalances.employeeId, me.id), eq(leaveBalances.fyStart, fy)));
        balances = bs
          .map((b) => ({
            name: types.find((t) => t.id === b.leaveTypeId)?.name ?? "",
            allotted: Number(b.allotted),
            used: Number(b.used),
          }))
          .filter((b) => b.allotted > 0);
        const rs = await tx
          .select()
          .from(leaveRequests)
          .where(eq(leaveRequests.employeeId, me.id))
          .orderBy(desc(leaveRequests.createdAt))
          .limit(20);
        mine = rs.map((r) => ({
          id: r.id,
          type: types.find((t) => t.id === r.leaveTypeId)?.name ?? "",
          from: r.fromDate,
          to: r.toDate,
          days: r.days,
          status: r.status,
          note: r.decisionNote,
        }));
      }
    }
    let queue: {
      id: string;
      who: string;
      type: string;
      from: string;
      to: string;
      days: string;
      reason: string | null;
    }[] = [];
    if (approve) {
      const pend = await tx
        .select({ r: leaveRequests, e: employees })
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .where(
          and(
            eq(leaveRequests.organizationId, ctx.organizationId),
            eq(leaveRequests.status, "pending"),
          ),
        )
        .orderBy(leaveRequests.fromDate);
      queue = pend
        .filter(
          ({ r, e }) =>
            r.employeeId !== ctx.employeeId &&
            (manage || (e.managerId && e.managerId === ctx.employeeId)),
        )
        .map(({ r, e }) => ({
          id: r.id,
          who: `${e.firstName} ${e.lastName}`.trim(),
          type: types.find((t) => t.id === r.leaveTypeId)?.name ?? "",
          from: r.fromDate,
          to: r.toDate,
          days: r.days,
          reason: r.reason,
        }));
    }
    return { types, balances, mine, queue };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Leave</h1>

      {apply && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.balances.map((b) => (
              <Card key={b.name}>
                <CardContent className="pt-5">
                  <p className="text-muted-foreground text-xs">{b.name}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {b.allotted - b.used}
                    <span className="text-muted-foreground text-sm font-normal">
                      {" "}
                      of {b.allotted} left
                    </span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Request leave</CardTitle>
              <CardDescription>Weekly offs and holidays are not counted.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.types.length ? (
                <ApplyForm
                  types={data.types.map((t) => ({ id: t.id, name: t.name, isPaid: t.isPaid }))}
                />
              ) : (
                <p className="text-muted-foreground text-sm">HR has not set up leave types yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>My requests</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {data.mine.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {r.type} · {r.days} day(s)
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {r.from}
                      {r.to !== r.from ? ` to ${r.to}` : ""}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    {(r.status === "pending" || (r.status === "approved" && r.from > today)) && (
                      <CancelButton id={r.id} />
                    )}
                  </div>
                </div>
              ))}
              {data.mine.length === 0 && (
                <p className="text-muted-foreground py-6 text-center text-sm">No requests yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {approve && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting your decision</CardTitle>
            <CardDescription>
              {manage ? "All pending requests." : "Requests from your team."}
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {data.queue.map((q) => (
              <div
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {q.who}: {q.type}, {q.days} day(s)
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {q.from}
                    {q.to !== q.from ? ` to ${q.to}` : ""}
                    {q.reason ? ` · ${q.reason}` : ""}
                  </p>
                </div>
                <DecideButtons id={q.id} />
              </div>
            ))}
            {data.queue.length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm">Nothing waiting.</p>
            )}
          </CardContent>
        </Card>
      )}

      {manage && (
        <Card>
          <CardHeader>
            <CardTitle>Leave types</CardTitle>
            <CardDescription>
              {data.types
                .map((t) => `${t.name} (${t.annualQuota}${t.isPaid ? "" : ", unpaid"})`)
                .join(" · ") || "None yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TypeForm empty={data.types.length === 0} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
