import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleAlert, Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Insight } from "@/lib/dashboard/insights";
import { cn } from "@/lib/utils";

const TONE_ICON = {
  danger: CircleAlert,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
} as const;
const TONE_CLASS = {
  danger: "text-destructive",
  warning: "text-warning",
  info: "text-primary",
  success: "text-success",
} as const;

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="text-primary size-4" aria-hidden /> Insights
        </CardTitle>
        <CardDescription>
          Checks run on your company data. AI-written insights arrive with PayBot.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {insights.map((i) => {
            const Icon = TONE_ICON[i.tone];
            const inner = (
              <div className="flex gap-3 py-3">
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[i.tone])} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{i.title}</p>
                  <p className="text-muted-foreground text-xs">{i.detail}</p>
                </div>
              </div>
            );
            return (
              <li key={i.id}>
                {i.href ? (
                  <Link
                    href={i.href}
                    className="hover:bg-muted/60 -mx-2 block rounded-lg px-2 transition-colors"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

const fmtWhen = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function ActivityFeed({
  items,
}: {
  items: { id: string; who: string; what: string; at: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>From the tamper-evident audit log.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState art="inbox" title="Nothing yet">
            Actions your team takes will show up here.
          </EmptyState>
        ) : (
          <ol className="relative space-y-4 border-s ps-5">
            {items.map((a) => (
              <li key={a.id} className="relative text-sm">
                <span
                  className="bg-primary absolute -start-[1.6rem] top-1.5 size-2 rounded-full"
                  aria-hidden
                />
                <p>
                  <span className="font-medium">{a.who}</span> {a.what}
                </p>
                <time dateTime={a.at} className="text-muted-foreground text-xs">
                  {fmtWhen.format(new Date(a.at))}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function CountdownCard({
  cutoffDate,
  payDate,
  daysToCutoff,
  daysToPay,
  runStatus,
}: {
  cutoffDate: string;
  payDate: string;
  daysToCutoff: number;
  daysToPay: number;
  runStatus: string;
}) {
  const done = runStatus === "paid" || runStatus === "processing" || runStatus === "approved";
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll countdown</CardTitle>
        <CardDescription>
          This month&apos;s run:{" "}
          <Badge tone={done ? "success" : runStatus === "none" ? "neutral" : "warning"}>
            {runStatus === "none" ? "not started" : runStatus}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        {[
          ["Attendance cutoff", daysToCutoff, cutoffDate],
          ["Pay day", daysToPay, payDate],
        ].map(([label, days, date]) => (
          <div key={String(label)} className="bg-muted/50 rounded-xl p-4">
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {days === 0 ? "Today" : days}
            </p>
            <p className="text-muted-foreground text-xs">
              {days === 0
                ? fmt(String(date))
                : `${days === 1 ? "day" : "days"} · ${fmt(String(date))}`}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function QuickActions({
  actions,
}: {
  actions: { href: string; label: string; icon: React.ReactNode }[];
}) {
  if (actions.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {actions.map((a) => (
          <Link
            key={a.href + a.label}
            href={a.href}
            className="hover:bg-muted hover:border-primary/40 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors"
          >
            <span className="text-primary">{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
