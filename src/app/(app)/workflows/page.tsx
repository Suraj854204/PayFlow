import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Workflow as WorkflowIcon, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DeleteWorkflowButton,
  EnableSwitch,
  NewWorkflowButton,
  RetryButton,
  TaskButtons,
} from "@/components/workflows/controls";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { workflowRuns, workflowTasks, workflows } from "@/lib/db/schema";
import { TRIGGERS } from "@/lib/workflow/model";
import { TEMPLATES } from "@/lib/workflow/templates";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

const TONE = {
  succeeded: "success",
  failed: "danger",
  waiting: "warning",
  running: "primary",
  queued: "neutral",
  cancelled: "neutral",
} as const;
const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export default async function WorkflowsPage() {
  const ctx = await requirePagePermission("workflows:manage");
  const orgId = ctx.organizationId;
  const { list, runs, tasks } = await withTenant(orgId, async (tx) => ({
    list: await tx
      .select({
        w: workflows,
        total: sql<number>`(select count(*)::int from workflow_runs r where r.workflow_id = ${workflows.id})`,
        failed: sql<number>`(select count(*)::int from workflow_runs r where r.workflow_id = ${workflows.id} and r.status = 'failed')`,
      })
      .from(workflows)
      .where(and(eq(workflows.organizationId, orgId), isNull(workflows.deletedAt)))
      .orderBy(desc(workflows.createdAt)),
    runs: await tx
      .select({ r: workflowRuns, name: workflows.name })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(eq(workflowRuns.organizationId, orgId))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(12),
    tasks: await tx
      .select()
      .from(workflowTasks)
      .where(and(eq(workflowTasks.organizationId, orgId), eq(workflowTasks.status, "open")))
      .orderBy(desc(workflowTasks.createdAt))
      .limit(20),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="text-muted-foreground text-sm">
            When something happens, do something. Build it visually, test it with sample data, and
            watch every run.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/workflows/pipeline"
            className="text-primary self-center text-sm hover:underline"
          >
            Automatic payroll
          </Link>
          <NewWorkflowButton label="New automation" />
        </div>
      </div>

      {tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for you</CardTitle>
            <CardDescription>Approvals and tasks that automations created.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {tasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {t.kind === "approval" ? "Approval" : "Task"}
                    {t.assigneeRole ? ` · for ${t.assigneeRole.replace("_", " ")}` : ""}
                    {t.detail ? ` · ${t.detail}` : ""}
                  </p>
                </div>
                <TaskButtons taskId={t.id} kind={t.kind as "task" | "approval"} title={t.title} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your automations</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {list.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing yet. Start from a ready-made template below.
            </p>
          )}
          {list.map(({ w, total, failed }) => (
            <div key={w.id} className="flex flex-wrap items-center gap-3 py-3">
              <WorkflowIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <Link href={`/workflows/${w.id}`} className="min-w-0 flex-1 hover:underline">
                <p className="truncate font-medium">{w.name}</p>
                <p className="text-muted-foreground text-xs">
                  When: {TRIGGERS[w.triggerKind].label} · {total} run{total === 1 ? "" : "s"}
                </p>
              </Link>
              {failed > 0 && <Badge tone="danger">{failed} failed</Badge>}
              <Badge tone={w.enabled ? "success" : "neutral"}>{w.enabled ? "On" : "Off"}</Badge>
              <EnableSwitch id={w.id} enabled={w.enabled} name={w.name} />
              <DeleteWorkflowButton id={w.id} name={w.name} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Each one is a normal automation you can change. Replace the placeholder links before
            turning it on.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <div key={t.key} className="flex flex-col justify-between gap-3 rounded-xl border p-4">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <Zap className="text-primary size-4" aria-hidden /> {t.name}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">{t.description}</p>
              </div>
              <div className="flex items-center justify-between">
                <Badge>{TRIGGERS[t.trigger].label}</Badge>
                <NewWorkflowButton templateKey={t.key} label="Use template" variant="outline" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {runs.length === 0 && <p className="text-muted-foreground py-4 text-sm">No runs yet.</p>}
          {runs.map(({ r, name }) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="text-muted-foreground text-xs">
                  {fmt.format(r.createdAt)}
                  {r.error ? ` · ${r.error}` : ""}
                </p>
              </div>
              <Badge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{r.status}</Badge>
              {r.status === "failed" && <RetryButton runId={r.id} />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
