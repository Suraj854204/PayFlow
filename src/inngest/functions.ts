import "server-only";
import { inngest } from "./client";
import { deliverWebhook, processRun, tick } from "@/lib/workflow/dispatch";
import { runPipelineSweep } from "@/lib/pipeline/sweep";

/** Inngest wraps the same functions the inline fallback calls, so behaviour is identical. */
export const workflowRun = inngest.createFunction(
  { id: "workflow-run", retries: 2, triggers: [{ event: "payflow/workflow.run" }] },
  async ({ event, step }) => {
    const { orgId, runId, decision } = event.data as {
      orgId: string;
      runId: string;
      decision?: { nodeId: string; approved: boolean };
    };
    await step.run("execute", () => processRun(orgId, runId, decision));
  },
);

export const webhookDeliver = inngest.createFunction(
  { id: "webhook-deliver", retries: 0, triggers: [{ event: "payflow/webhook.deliver" }] },
  async ({ event, step }) => {
    const { orgId, deliveryId } = event.data as { orgId: string; deliveryId: string };
    // Backoff and give-up rules live in the delivery row, so one attempt per invocation.
    await step.run("deliver", () => deliverWebhook(orgId, deliveryId));
  },
);

/** Every 5 minutes: retry due webhooks, rescue stranded runs, advance payroll pipelines, scan deadlines. */
export const sweep = inngest.createFunction(
  { id: "automation-sweep", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const a = await step.run("tick", () => tick());
    const b = await step.run("pipelines", () => runPipelineSweep());
    return { ...a, ...b };
  },
);

export const functions = [workflowRun, webhookDeliver, sweep];
