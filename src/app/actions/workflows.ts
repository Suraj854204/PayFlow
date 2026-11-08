"use server";

import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { API_SCOPE_IDS } from "@/lib/api/scopes";
import { hashKey } from "@/lib/api/keys";
import { encrypt } from "@/lib/crypto";
import {
  apiKeys,
  payrollPipelines,
  webhookDeliveries,
  webhookEndpoints,
  workflowRuns,
  workflowTasks,
  workflows,
  type TriggerKind,
  type WorkflowDefinition,
} from "@/lib/db/schema";
import { advancePipeline } from "@/lib/pipeline/sweep";
import { processRun, scheduleWork } from "@/lib/workflow/dispatch";
import { WEBHOOK_EVENTS } from "@/lib/workflow/events";
import { MAX_NODES, TRIGGER_KINDS, triggerOf, validateDefinition } from "@/lib/workflow/model";
import { SAMPLE_PAYLOADS } from "@/lib/workflow/samples";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/workflow/ssrf";
import { newWebhookSecret } from "@/lib/workflow/signing";
import { TEMPLATES } from "@/lib/workflow/templates";

const PATHS = ["/workflows"];
const uuid = z.string().uuid();

const defSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        type: z.enum(["trigger", "condition", "action"]),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(MAX_NODES),
  edges: z
    .array(
      z.object({
        id: z.string().max(120),
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().nullable().optional(),
      }),
    )
    .max(MAX_NODES * 2),
});

function checked(def: WorkflowDefinition) {
  const issues = validateDefinition(def);
  if (issues.length) throw new UserFacingError(issues[0].message);
  const kind = triggerOf(def);
  if (!kind) throw new UserFacingError("Add a trigger.");
  return kind;
}

export async function createWorkflowAction(input: unknown) {
  const d = z
    .object({
      templateKey: z.string().max(60).optional(),
      trigger: z.enum(TRIGGER_KINDS as [string, ...string[]]).optional(),
    })
    .parse(input);
  return runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      const tpl = d.templateKey ? TEMPLATES.find((t) => t.key === d.templateKey) : undefined;
      if (d.templateKey && !tpl) throw new UserFacingError("Template not found.");
      const trigger: TriggerKind =
        tpl?.trigger ?? (d.trigger as TriggerKind | undefined) ?? "leave.applied";
      const definition: WorkflowDefinition = tpl
        ? tpl.build()
        : {
            nodes: [
              { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: trigger } },
            ],
            edges: [],
          };
      const [row] = await tx
        .insert(workflows)
        .values({
          organizationId: ctx.organizationId,
          name: tpl?.name ?? "Untitled automation",
          description: tpl?.description ?? null,
          triggerKind: trigger,
          definition,
          templateKey: tpl?.key ?? null,
          createdBy: ctx.user.id,
        })
        .returning({ id: workflows.id });
      await audit({
        action: "workflow.created",
        entityType: "workflow",
        entityId: row.id,
        newValues: { template: tpl?.key ?? null },
      });
      return { id: row.id };
    },
    PATHS,
  );
}

export async function saveWorkflowAction(input: unknown) {
  const d = z
    .object({
      id: uuid,
      name: z.string().trim().min(1, "Give it a name.").max(80),
      description: z.string().trim().max(300).optional(),
      definition: defSchema,
    })
    .parse(input);
  return runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      const def = d.definition as WorkflowDefinition;
      const kind = checked(def);
      const res = await tx
        .update(workflows)
        .set({
          name: d.name,
          description: d.description ?? null,
          definition: def,
          triggerKind: kind,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflows.id, d.id),
            eq(workflows.organizationId, ctx.organizationId),
            isNull(workflows.deletedAt),
          ),
        )
        .returning({ id: workflows.id });
      if (res.length === 0) throw new UserFacingError("Automation not found.");
      await audit({
        action: "workflow.updated",
        entityType: "workflow",
        entityId: d.id,
        newValues: { name: d.name, nodes: def.nodes.length },
      });
      return {};
    },
    [...PATHS, `/workflows/${d.id}`],
  );
}

export async function toggleWorkflowAction(input: unknown) {
  const d = z.object({ id: uuid, enabled: z.boolean() }).parse(input);
  return runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      const [wf] = await tx
        .select()
        .from(workflows)
        .where(
          and(
            eq(workflows.id, d.id),
            eq(workflows.organizationId, ctx.organizationId),
            isNull(workflows.deletedAt),
          ),
        );
      if (!wf) throw new UserFacingError("Automation not found.");
      if (d.enabled) checked(wf.definition);
      await tx.update(workflows).set({ enabled: d.enabled }).where(eq(workflows.id, d.id));
      await audit({
        action: d.enabled ? "workflow.enabled" : "workflow.disabled",
        entityType: "workflow",
        entityId: d.id,
      });
      return {};
    },
    PATHS,
  );
}

export async function deleteWorkflowAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  return runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      const r = await tx
        .update(workflows)
        .set({ deletedAt: new Date(), enabled: false })
        .where(
          and(
            eq(workflows.id, id),
            eq(workflows.organizationId, ctx.organizationId),
            isNull(workflows.deletedAt),
          ),
        )
        .returning({ id: workflows.id });
      if (r.length === 0) throw new UserFacingError("Automation not found.");
      await audit({ action: "workflow.deleted", entityType: "workflow", entityId: id });
      return {};
    },
    PATHS,
  );
}

/** Runs the automation once with clearly marked sample data, so you can see exactly what it would do. */
export async function testWorkflowAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  let work: { orgId: string; runId: string } | null = null;
  const res = await runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
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
      if (!wf) throw new UserFacingError("Automation not found.");
      checked(wf.definition);
      const [run] = await tx
        .insert(workflowRuns)
        .values({
          organizationId: ctx.organizationId,
          workflowId: id,
          triggerKind: wf.triggerKind,
          payload: SAMPLE_PAYLOADS[wf.triggerKind],
        })
        .returning({ id: workflowRuns.id });
      await audit({ action: "workflow.test_run", entityType: "workflow", entityId: id });
      work = { orgId: ctx.organizationId, runId: run.id };
      return { runId: run.id };
    },
    PATHS,
  );
  const w = work as { orgId: string; runId: string } | null;
  if (res.ok && w) await scheduleWork(w.orgId, { runIds: [w.runId], deliveryIds: [] });
  return res;
}

/** Retries a failed run: finished steps are not repeated. */
export async function retryRunAction(input: unknown) {
  const { runId } = z.object({ runId: uuid }).parse(input);
  const res = await runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      const [run] = await tx
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(
          and(eq(workflowRuns.id, runId), eq(workflowRuns.organizationId, ctx.organizationId)),
        );
      if (!run) throw new UserFacingError("Run not found.");
      if (run.status !== "failed") throw new UserFacingError("Only a failed run can be retried.");
      await audit({ action: "workflow.run_retried", entityType: "workflow_run", entityId: runId });
      return { orgId: ctx.organizationId };
    },
    PATHS,
  );
  if (res.ok) await processRun(res.data.orgId, runId);
  return res.ok ? { ok: true as const, data: {} } : res;
}

const decideSchema = z.object({ taskId: uuid, decision: z.enum(["approved", "rejected", "done"]) });

/** Completes a task, or decides an approval, which resumes the paused automation. */
export async function decideTaskAction(input: unknown) {
  const d = decideSchema.parse(input);
  let resume: { orgId: string; runId: string; nodeId: string; approved: boolean } | null = null;
  const res = await runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      const [t] = await tx
        .select()
        .from(workflowTasks)
        .where(
          and(eq(workflowTasks.id, d.taskId), eq(workflowTasks.organizationId, ctx.organizationId)),
        )
        .for("update");
      if (!t) throw new UserFacingError("Task not found.");
      if (t.status !== "open") throw new UserFacingError("This was already decided.");
      if (t.assigneeRole && ctx.role !== t.assigneeRole && ctx.role !== "super_admin")
        throw new UserFacingError("This is assigned to a different role.");
      if (t.kind === "approval" && d.decision === "done")
        throw new UserFacingError("Approve or reject this one.");
      if (t.kind === "task" && d.decision !== "done")
        throw new UserFacingError("Mark this task as done.");
      await tx
        .update(workflowTasks)
        .set({ status: d.decision, decidedBy: ctx.user.id, decidedAt: new Date() })
        .where(eq(workflowTasks.id, t.id));
      await audit({
        action: `workflow_task.${d.decision}`,
        entityType: "workflow_task",
        entityId: t.id,
        newValues: { title: t.title },
      });
      if (t.kind === "approval" && t.runId && t.nodeId)
        resume = {
          orgId: ctx.organizationId,
          runId: t.runId,
          nodeId: t.nodeId,
          approved: d.decision === "approved",
        };
      return {};
    },
    PATHS,
  );
  const r = resume as { orgId: string; runId: string; nodeId: string; approved: boolean } | null;
  if (res.ok && r) await processRun(r.orgId, r.runId, { nodeId: r.nodeId, approved: r.approved });
  return res;
}

// ---------- Payroll pipeline ----------
const pipelineSchema = z.object({
  enabled: z.boolean(),
  startDay: z.number().int().min(1).max(28),
  reminderHours: z.number().int().min(1).max(168),
});

export async function savePipelineAction(input: unknown) {
  const d = pipelineSchema.parse(input);
  return runAction(
    "workflows:manage",
    async ({ ctx, tx, audit }) => {
      await tx
        .insert(payrollPipelines)
        .values({ organizationId: ctx.organizationId, ...d })
        .onConflictDoUpdate({
          target: payrollPipelines.organizationId,
          set: { ...d, updatedAt: new Date() },
        });
      await audit({ action: "pipeline.updated", entityType: "payroll_pipeline", newValues: d });
      return {};
    },
    [...PATHS, "/workflows/pipeline"],
  );
}

/** Advances the pipeline for last month right now instead of waiting for the next sweep. */
export async function runPipelineNowAction() {
  const res = await runAction("workflows:manage", async ({ ctx, audit }) => {
    await audit({ action: "pipeline.run_now", entityType: "payroll_pipeline" });
    return { orgId: ctx.organizationId };
  });
  if (!res.ok) return res;
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const stoppedAt = await advancePipeline(res.data.orgId, d.toISOString().slice(0, 7));
  return { ok: true as const, data: { stoppedAt } };
}

// ---------- API keys ----------
const keySchema = z.object({
  name: z.string().trim().min(1, "Name the key.").max(60),
  scopes: z.array(z.enum(API_SCOPE_IDS)).min(1, "Choose at least one permission."),
  rateLimitPerMin: z.number().int().min(1).max(1000).default(60),
  expiresInDays: z.number().int().min(1).max(730).nullable().default(null),
});

export async function createApiKeyAction(input: unknown) {
  const d = keySchema.parse(input);
  return runAction(
    "apikeys:manage",
    async ({ ctx, tx, audit }) => {
      const key = `pf_live_${randomBytes(24).toString("hex")}`;
      const [row] = await tx
        .insert(apiKeys)
        .values({
          organizationId: ctx.organizationId,
          name: d.name,
          prefix: key.slice(0, 16),
          keyHash: hashKey(key),
          scopes: d.scopes,
          rateLimitPerMin: d.rateLimitPerMin,
          expiresAt: d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86_400_000) : null,
          createdBy: ctx.user.id,
        })
        .returning({ id: apiKeys.id });
      await audit({
        action: "api_key.created",
        entityType: "api_key",
        entityId: row.id,
        newValues: { name: d.name, scopes: d.scopes },
      });
      // The only time the full key exists outside the caller's hands.
      return { id: row.id, key };
    },
    ["/developers"],
  );
}

export async function revokeApiKeyAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  return runAction(
    "apikeys:manage",
    async ({ ctx, tx, audit }) => {
      const r = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.organizationId, ctx.organizationId),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });
      if (r.length === 0) throw new UserFacingError("Key not found or already revoked.");
      await audit({ action: "api_key.revoked", entityType: "api_key", entityId: id });
      return {};
    },
    ["/developers"],
  );
}

// ---------- Webhook endpoints ----------
const endpointSchema = z.object({
  url: z.string().trim().url("Enter a full URL."),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event."),
});

export async function createWebhookAction(input: unknown) {
  const d = endpointSchema.parse(input);
  return runAction(
    "apikeys:manage",
    async ({ ctx, tx, audit }) => {
      try {
        await assertSafeUrl(d.url);
      } catch (e) {
        if (e instanceof UnsafeUrlError) throw new UserFacingError(e.message);
        throw new UserFacingError("We could not look up that address.");
      }
      const secret = newWebhookSecret();
      const [row] = await tx
        .insert(webhookEndpoints)
        .values({
          organizationId: ctx.organizationId,
          url: d.url,
          events: d.events,
          secretEnc: encrypt(secret),
          createdBy: ctx.user.id,
        })
        .returning({ id: webhookEndpoints.id });
      await audit({
        action: "webhook.created",
        entityType: "webhook_endpoint",
        entityId: row.id,
        newValues: { url: d.url, events: d.events },
      });
      return { id: row.id, secret };
    },
    ["/developers"],
  );
}

export async function deleteWebhookAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  return runAction(
    "apikeys:manage",
    async ({ ctx, tx, audit }) => {
      const r = await tx
        .update(webhookEndpoints)
        .set({ deletedAt: new Date(), enabled: false })
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.organizationId, ctx.organizationId),
            isNull(webhookEndpoints.deletedAt),
          ),
        )
        .returning({ id: webhookEndpoints.id });
      if (r.length === 0) throw new UserFacingError("Endpoint not found.");
      await audit({ action: "webhook.deleted", entityType: "webhook_endpoint", entityId: id });
      return {};
    },
    ["/developers"],
  );
}

/** Sends a signed `ping` so you can check your receiver's signature handling. */
export async function pingWebhookAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  let work: { orgId: string; deliveryId: string } | null = null;
  const res = await runAction(
    "apikeys:manage",
    async ({ ctx, tx }) => {
      const [ep] = await tx
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.organizationId, ctx.organizationId),
            isNull(webhookEndpoints.deletedAt),
          ),
        );
      if (!ep) throw new UserFacingError("Endpoint not found.");
      const [d] = await tx
        .insert(webhookDeliveries)
        .values({
          organizationId: ctx.organizationId,
          endpointId: id,
          event: "ping",
          payload: { test: true },
        })
        .returning({ id: webhookDeliveries.id });
      work = { orgId: ctx.organizationId, deliveryId: d.id };
      return {};
    },
    ["/developers"],
  );
  const w = work as { orgId: string; deliveryId: string } | null;
  if (res.ok && w) await scheduleWork(w.orgId, { runIds: [], deliveryIds: [w.deliveryId] });
  return res;
}

/** Puts a failed delivery back in the queue for another round of attempts. */
export async function redeliverAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  let work: { orgId: string; deliveryId: string } | null = null;
  const res = await runAction(
    "apikeys:manage",
    async ({ ctx, tx }) => {
      const r = await tx
        .update(webhookDeliveries)
        .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
        .where(
          and(
            eq(webhookDeliveries.id, id),
            eq(webhookDeliveries.organizationId, ctx.organizationId),
            eq(webhookDeliveries.status, "failed"),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      if (r.length === 0) throw new UserFacingError("Only a failed delivery can be resent.");
      work = { orgId: ctx.organizationId, deliveryId: id };
      return {};
    },
    ["/developers"],
  );
  const w = work as { orgId: string; deliveryId: string } | null;
  if (res.ok && w) await scheduleWork(w.orgId, { runIds: [], deliveryIds: [w.deliveryId] });
  return res;
}
