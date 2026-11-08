import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ArrowLeft, CheckCircle2, CircleDashed, CircleSlash, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowBuilder } from "@/components/workflows/builder";
import { EnableSwitch, RetryButton, TestButton } from "@/components/workflows/controls";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { workflowRuns, workflows } from "@/lib/db/schema";

export const metadata = { title: "Edit automation" };
export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Kolkata",
});
const ICON = {
  succeeded: CheckCircle2,
  failed: XCircle,
  skipped: CircleSlash,
  waiting: Clock,
} as const;
const COLOR = {
  succeeded: "text-success",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
  waiting: "text-warning",
} as const;
const TONE = {
  succeeded: "success",
  failed: "danger",
  waiting: "warning",
  running: "primary",
  queued: "neutral",
  cancelled: "neutral",
} as const;

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("workflows:manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withTenant(ctx.organizationId, async (tx) => {
    const [wf] = await tx
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.id, id),
          eq(workflows.organizationId, ctx.organizationId),
          isNull(workflows.deletedAt),
        ),
      );
    if (!wf) return null;
    const runs = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(10);
    return { wf, runs };
  });
  if (!data) notFound();
  const { wf, runs } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/workflows"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> All automations
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm">{wf.enabled ? "On" : "Off"}</span>
          <EnableSwitch id={wf.id} enabled={wf.enabled} name={wf.name} />
          <TestButton id={wf.id} />
        </div>
      </div>

      <WorkflowBuilder
        id={wf.id}
        initialName={wf.name}
        initialDescription={wf.description ?? ""}
        initialDefinition={wf.definition}
      />

      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {runs.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No runs yet. Use “Test run” to try it with sample data.
            </p>
          )}
          {runs.map((r) => (
            <div key={r.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{fmt.format(r.createdAt)}</p>
                {(r.payload as { test?: boolean }).test && <Badge>Test</Badge>}
                <Badge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{r.status}</Badge>
                {r.status === "failed" && <RetryButton runId={r.id} />}
              </div>
              {r.error && <p className="text-destructive mt-1 text-sm">{r.error}</p>}
              <ol className="mt-2 space-y-1">
                {r.steps.map((s, i) => {
                  const Icon = ICON[s.status] ?? CircleDashed;
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Icon
                        className={`mt-0.5 size-4 shrink-0 ${COLOR[s.status] ?? ""}`}
                        aria-hidden
                      />
                      <span>
                        {s.label}
                        {s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}
                        {s.attempts > 1 ? (
                          <span className="text-muted-foreground"> · {s.attempts} attempts</span>
                        ) : null}
                        <span className="sr-only"> ({s.status})</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
