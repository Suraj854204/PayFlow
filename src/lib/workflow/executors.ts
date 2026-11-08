import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/lib/db";
import { memberships, users, workflowTasks } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { ACTION_CONFIG, type ActionType } from "./model";
import { interpolate, type Executor, type Json } from "./engine";
import { safePost } from "./ssrf";
import { sendMail } from "@/lib/mail/send";

const ADMIN_ROLES = ["super_admin", "hr_admin"] as const;

async function hrRecipients(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select({ userId: memberships.userId, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, orgId),
          eq(memberships.isActive, true),
          inArray(memberships.role, [...ADMIN_ROLES]),
        ),
      ),
  );
}

/** Sends through Resend's REST API. Without RESEND_API_KEY the step is skipped and says so. */
export async function sendEmail(to: string[], subject: string, text: string) {
  return sendMail({ to, subject, text });
}

async function whatsapp(to: string, message: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return false;
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "text",
      text: { body: message },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API returned ${res.status}`);
  return true;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Real side effects for each action type. Throwing means "retry"; returning skipped means "nothing to do". */
export function buildExecutor(orgId: string, runId: string): Executor {
  return async (action: ActionType, raw, { payload, node }) => {
    const parsed = ACTION_CONFIG[action].safeParse(raw);
    if (!parsed.success)
      throw new Error(`Invalid ${action} settings: ${parsed.error.issues[0]?.message}`);
    const c = parsed.data as Record<string, unknown>;
    const fill = (t: unknown) => interpolate(str(t), payload as Json);
    const emp = (payload as { employee?: { email?: string; userId?: string } }).employee;

    switch (action) {
      case "email": {
        const to =
          c.to === "employee"
            ? emp?.email
              ? [emp.email]
              : []
            : c.to === "custom"
              ? [str(c.customEmail)]
              : (await hrRecipients(orgId)).map((r) => r.email);
        if (to.length === 0) return { status: "skipped", note: "No recipient email found" };
        const r = await sendEmail(to, fill(c.subject), fill(c.body));
        return r.sent
          ? { status: "ok", note: `Emailed ${to.length} recipient(s)` }
          : { status: "skipped", note: r.reason };
      }
      case "slack":
      case "teams": {
        const body = JSON.stringify({ text: fill(c.message) });
        const r = await safePost(str(c.url), body);
        if (!r.ok) throw new Error(`${action} returned HTTP ${r.status}`);
        return { status: "ok", note: `Posted to ${action}` };
      }
      case "whatsapp": {
        const sent = await whatsapp(str(c.to), fill(c.message));
        return sent
          ? { status: "ok", note: "WhatsApp message sent" }
          : {
              status: "skipped",
              note: "WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID)",
            };
      }
      case "webhook": {
        const body = JSON.stringify({
          event: "workflow.webhook",
          message: fill(c.message),
          data: payload,
        });
        const r = await safePost(str(c.url), body);
        if (!r.ok) throw new Error(`Webhook returned HTTP ${r.status}`);
        return { status: "ok", note: `Webhook answered ${r.status}` };
      }
      case "notify": {
        const targets =
          c.audience === "employee"
            ? emp?.userId
              ? [emp.userId]
              : []
            : (await hrRecipients(orgId)).map((r) => r.userId);
        if (targets.length === 0) return { status: "skipped", note: "No one to notify" };
        await withTenant(orgId, async (tx) => {
          for (const userId of targets)
            await notify(tx, orgId, {
              userId,
              type: "workflow",
              title: fill(c.title),
              body: c.body ? fill(c.body) : undefined,
              href: "/workflows",
            });
        });
        return { status: "ok", note: `Notified ${targets.length} person(s)` };
      }
      case "task":
      case "approval": {
        const kind = action === "task" ? "task" : "approval";
        await withTenant(orgId, async (tx) => {
          const existing = await tx
            .select({ id: workflowTasks.id })
            .from(workflowTasks)
            .where(and(eq(workflowTasks.runId, runId), eq(workflowTasks.nodeId, node.id)))
            .limit(1);
          // Retries must not create a second task for the same step.
          if (existing.length === 0)
            await tx.insert(workflowTasks).values({
              organizationId: orgId,
              runId,
              nodeId: node.id,
              kind,
              title: fill(c.title),
              detail: c.detail ? fill(c.detail) : null,
              assigneeRole: (c.assigneeRole as string | undefined) ?? null,
            });
        });
        return action === "approval"
          ? { status: "ok", waiting: true, note: "Waiting for a decision" }
          : { status: "ok", note: "Task created" };
      }
    }
  };
}
