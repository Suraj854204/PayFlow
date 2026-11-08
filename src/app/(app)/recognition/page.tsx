import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Award, Flame, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GiveForm } from "@/components/engagement/give-form";
import { requireFlagOn } from "@/lib/enterprise/flags-server";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { loadMyEngagement, recentRecognitions } from "@/lib/engagement/load";

export const metadata = { title: "Recognition" };
export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});
const VALUE_LABEL: Record<string, string> = {
  teamwork: "Teamwork",
  ownership: "Ownership",
  customer_focus: "Customer focus",
  innovation: "Innovation",
  going_extra_mile: "Going the extra mile",
};

export default async function RecognitionPage() {
  const ctx = await requireContext();
  await withTenant(ctx.organizationId, (tx) =>
    requireFlagOn(tx, ctx.organizationId, "recognition"),
  );
  if (!ctx.employeeId) redirect("/dashboard?denied=1");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const d = await withTenant(ctx.organizationId, async (tx) => {
    const mine = await loadMyEngagement(tx, ctx.organizationId, ctx.employeeId!, today);
    const feed = await recentRecognitions(tx, ctx.organizationId);
    const ids = [...new Set(feed.flatMap((f) => [f.fromId, f.toId]))];
    const names = ids.length
      ? await tx
          .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
          .from(employees)
          .where(inArray(employees.id, ids))
      : [];
    const colleagues = await tx
      .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, ctx.organizationId),
          isNull(employees.deletedAt),
          ne(employees.id, ctx.employeeId!),
          ne(employees.status, "exited"),
        ),
      )
      .orderBy(employees.firstName);
    return {
      mine,
      feed,
      names: new Map(names.map((n) => [n.id, `${n.first} ${n.last}`.trim()])),
      colleagues,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recognition and streaks</h1>
        <p className="text-muted-foreground text-sm">
          Streaks and badges come from your real attendance. Recognition comes from your colleagues.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Flame className="text-warning size-8" aria-hidden />
            <div>
              <p className="text-3xl font-semibold tabular-nums" data-testid="streak-days">
                {d.mine.streak.days}
              </p>
              <p className="text-muted-foreground text-xs">
                working days in a row (best {d.mine.streak.best})
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-3xl font-semibold tabular-nums">{d.mine.received}</p>
            <p className="text-muted-foreground text-xs">times recognised</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-3xl font-semibold tabular-nums">{d.mine.given}</p>
            <p className="text-muted-foreground text-xs">colleagues you recognised</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
          <CardDescription>
            {d.mine.badges.filter((b) => b.earned).length} of {d.mine.badges.length} earned
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {d.mine.badges.map((b) => (
            <div
              key={b.key}
              className={`flex items-start gap-3 rounded-xl border p-3 ${b.earned ? "" : "opacity-70"}`}
              data-badge={b.key}
              data-earned={b.earned}
            >
              {b.earned ? (
                <Award className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              ) : (
                <Lock className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {b.title} <span className="sr-only">{b.earned ? "(earned)" : "(locked)"}</span>
                </p>
                <p className="text-muted-foreground text-xs">{b.description}</p>
                {!b.earned && (
                  <div
                    className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuenow={Math.round(b.progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${b.title} progress`}
                  >
                    <div className="bg-primary h-full" style={{ width: `${b.progress * 100}%` }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recognise a colleague</CardTitle>
        </CardHeader>
        <CardContent>
          <GiveForm
            colleagues={d.colleagues.map((c) => ({
              id: c.id,
              name: `${c.first} ${c.last}`.trim(),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent recognition</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {d.feed.length === 0 && (
            <p className="text-muted-foreground py-2 text-sm">Be the first to say thanks.</p>
          )}
          {d.feed.map((f) => (
            <div key={f.id} className="py-3 text-sm">
              <p>
                <strong>{d.names.get(f.fromId) ?? "A colleague"}</strong> recognised{" "}
                <strong>{d.names.get(f.toId) ?? "a colleague"}</strong> for{" "}
                {VALUE_LABEL[f.value] ?? f.value}
              </p>
              <p className="text-muted-foreground">
                “{f.message}” · {fmt.format(f.at)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
