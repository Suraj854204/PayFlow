"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { analyzeRun } from "@/lib/anomaly/load";
import { anomalyDismissals, payrollRuns } from "@/lib/db/schema";
import { ForbiddenError, canAny } from "@/lib/rbac";

const dismissSchema = z.object({
  runId: z.string().uuid(),
  key: z.string().min(1).max(200),
  reason: z.string().trim().min(3, "Say why this is expected.").max(300),
});

function assertReviewer(role: Parameters<typeof canAny>[0]) {
  if (!canAny(role, ["payroll:create", "payroll:approve"]))
    throw new ForbiddenError("payroll:create");
}

/** Records that a flagged anomaly is expected, with the reason. Only for runs that can still change. */
export async function dismissAnomalyAction(input: unknown) {
  return runAction(
    "payroll:read",
    async ({ ctx, tx, audit }) => {
      assertReviewer(ctx.role);
      const d = dismissSchema.parse(input);
      const [run] = await tx
        .select()
        .from(payrollRuns)
        .where(
          and(eq(payrollRuns.id, d.runId), eq(payrollRuns.organizationId, ctx.organizationId)),
        );
      if (!run) throw new UserFacingError("Payroll run not found.");
      if (run.status !== "draft" && run.status !== "review")
        throw new UserFacingError("This run can no longer be changed.");
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      const found = await analyzeRun(tx, ctx.organizationId, d.runId, today);
      const hit = found?.anomalies.find((a) => a.key === d.key);
      if (!hit) throw new UserFacingError("That anomaly is no longer flagged.");
      await tx
        .insert(anomalyDismissals)
        .values({
          organizationId: ctx.organizationId,
          runId: d.runId,
          key: d.key,
          reason: d.reason,
          dismissedBy: ctx.user.id,
        })
        .onConflictDoNothing();
      await audit({
        action: "anomaly.dismissed",
        entityType: "payroll_run",
        entityId: d.runId,
        newValues: { key: d.key, title: hit.title, reason: d.reason },
      });
      return null;
    },
    [],
  );
}

export async function restoreAnomalyAction(input: unknown) {
  return runAction(
    "payroll:read",
    async ({ ctx, tx, audit }) => {
      assertReviewer(ctx.role);
      const d = z
        .object({ runId: z.string().uuid(), key: z.string().min(1).max(200) })
        .parse(input);
      const [run] = await tx
        .select()
        .from(payrollRuns)
        .where(
          and(eq(payrollRuns.id, d.runId), eq(payrollRuns.organizationId, ctx.organizationId)),
        );
      if (!run) throw new UserFacingError("Payroll run not found.");
      if (run.status !== "draft" && run.status !== "review")
        throw new UserFacingError("This run can no longer be changed.");
      const del = await tx
        .delete(anomalyDismissals)
        .where(and(eq(anomalyDismissals.runId, d.runId), eq(anomalyDismissals.key, d.key)))
        .returning();
      if (del.length === 0) throw new UserFacingError("Nothing to restore.");
      await audit({
        action: "anomaly.restored",
        entityType: "payroll_run",
        entityId: d.runId,
        oldValues: { key: d.key, reason: del[0].reason },
      });
      return null;
    },
    [],
  );
}
