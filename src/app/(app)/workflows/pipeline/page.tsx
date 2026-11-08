import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PipelineForm } from "@/components/workflows/pipeline-form";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { payrollPipelines, pipelineSteps } from "@/lib/db/schema";
import { STEP_LABEL, STEP_ORDER } from "@/lib/pipeline/labels";
import { addMonths } from "@/lib/payroll/period";

export const metadata = { title: "Automatic payroll" };
export const dynamic = "force-dynamic";

const ICON = {
  done: CheckCircle2,
  skipped: CheckCircle2,
  blocked: AlertTriangle,
  failed: XCircle,
} as const;
const COLOR = {
  done: "text-success",
  skipped: "text-muted-foreground",
  blocked: "text-warning",
  failed: "text-destructive",
} as const;

export default async function PipelinePage() {
  const ctx = await requirePagePermission("workflows:manage");
  const month = addMonths(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7), -1);
  const { cfg, steps } = await withTenant(ctx.organizationId, async (tx) => ({
    cfg: (
      await tx
        .select()
        .from(payrollPipelines)
        .where(eq(payrollPipelines.organizationId, ctx.organizationId))
    )[0],
    steps: await tx
      .select()
      .from(pipelineSteps)
      .where(
        and(eq(pipelineSteps.organizationId, ctx.organizationId), eq(pipelineSteps.month, month)),
      ),
  }));
  const byStep = new Map(steps.map((s) => [s.step, s]));

  return (
    <div className="space-y-6">
      <Link
        href="/workflows"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> All automations
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automatic payroll</h1>
        <p className="text-muted-foreground text-sm">
          Each month PayFlow locks attendance, drafts payroll, checks it and submits it for
          approval. It stops and tells you if anything looks wrong. A person always approves, and
          payment is always started by a person.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineForm
            initial={{
              enabled: cfg?.enabled ?? false,
              startDay: cfg?.startDay ?? 1,
              reminderHours: cfg?.reminderHours ?? 24,
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Progress for {month}</CardTitle>
          <CardDescription>Steps already done are never repeated.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {STEP_ORDER.map((s) => {
              const row = byStep.get(s);
              const Icon = row ? ICON[row.status as keyof typeof ICON] : CircleDashed;
              return (
                <li key={s} className="flex items-start gap-3">
                  <Icon
                    className={`mt-0.5 size-5 shrink-0 ${row ? COLOR[row.status as keyof typeof COLOR] : "text-muted-foreground"}`}
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {STEP_LABEL[s]}{" "}
                      {row && (
                        <Badge
                          tone={
                            row.status === "done"
                              ? "success"
                              : row.status === "blocked"
                                ? "warning"
                                : row.status === "failed"
                                  ? "danger"
                                  : "neutral"
                          }
                        >
                          {row.status}
                        </Badge>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">{row?.detail ?? "Not started"}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
