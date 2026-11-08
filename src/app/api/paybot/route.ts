import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { withTenant } from "@/lib/db";
import { loadFlags } from "@/lib/enterprise/flags-server";
import { can } from "@/lib/rbac";
import { rateLimit } from "@/lib/rate-limit";
import { ensureSession, loadHistory, saveMessage } from "@/lib/ai/chat";
import { fallbackModel } from "@/lib/ai/fallback";
import { suggestFollowUps } from "@/lib/ai/followups";
import { geminiModel } from "@/lib/ai/gemini";
import { clampInput, looksLikeJailbreak, maskPii } from "@/lib/ai/guard";
import { systemPrompt } from "@/lib/ai/prompt";
import { runWithFallback } from "@/lib/ai/reply";
import { toolEnv, toolsFor } from "@/lib/ai/tools";
import type { AgentEvent } from "@/lib/ai/types";
import { logUsage, tokensUsedToday, type UsageStatus } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().uuid().nullish(),
});
const REFUSAL =
  "I can't change my rules or share how I work. I can help with your pay, leave, tax and, depending on your role, payroll and team questions. What would you like to know?";

const json = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return json("Unauthorized", 401);
  if (!can(ctx.role, "ai:use")) return json("Forbidden", 403);
  const flags = await withTenant(ctx.organizationId, (tx) => loadFlags(tx, ctx.organizationId));
  if (!flags.paybot) return json("PayBot is turned off for your company.", 403);
  // Same-origin only: a form on another site must not be able to drive the assistant.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json("Send a message of up to 4,000 characters.", 400);

  const usage = (status: UsageStatus, model = "none", i = 0, o = 0) =>
    withTenant(ctx.organizationId, (tx) =>
      logUsage(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        feature: "paybot",
        model,
        inputTokens: i,
        outputTokens: o,
        status,
      }),
    ).catch(() => {});

  const rl = await rateLimit("paybot", ctx.user.id, 20, "1 m");
  if (!rl.success) {
    await usage("rate_limited");
    return json("You're sending messages too quickly. Wait a few seconds and try again.", 429);
  }
  const used = await withTenant(ctx.organizationId, (tx) =>
    tokensUsedToday(tx, ctx.organizationId, ctx.user.id),
  );
  if (used >= env.AI_DAILY_TOKEN_LIMIT) {
    await usage("budget");
    return json("You've reached today's PayBot limit. It resets at midnight IST.", 429);
  }

  // Anything stored or sent to a model has PII masked first.
  const clean = clampInput(parsed.data.message);
  const { text: message } = maskPii(clean);
  const sessionId = await ensureSession(
    ctx.organizationId,
    ctx.user.id,
    parsed.data.sessionId,
    message,
  );
  if (!sessionId) return json("That conversation was not found.", 404);

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const company = ctx.companies.find((c) => c.id === ctx.organizationId)?.name ?? "your company";
  const history = await loadHistory(ctx.organizationId, sessionId);
  await saveMessage(ctx.organizationId, sessionId, { role: "user", content: message });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        if (looksLikeJailbreak(clean)) {
          send({ type: "text", delta: REFUSAL });
          const id = await saveMessage(ctx.organizationId, sessionId, {
            role: "assistant",
            content: REFUSAL,
            engine: "fallback",
          });
          await usage("blocked");
          send({
            type: "done",
            engine: "fallback",
            model: "guard",
            inputTokens: 0,
            outputTokens: 0,
            messageId: id,
          });
          return;
        }
        const primary = env.GEMINI_API_KEY
          ? geminiModel(env.GEMINI_API_KEY, env.GEMINI_MODEL)
          : fallbackModel(today);
        const e = toolEnv(ctx, today, sessionId);
        const sys = systemPrompt({
          role: ctx.role,
          companyName: company,
          userName: ctx.user.name,
          today,
          toolNames: toolsFor(ctx).map((t) => t.name),
        });
        const gen = runWithFallback(primary, fallbackModel(today), {
          system: sys,
          history: [...history, { role: "user", text: message }],
          env: e,
          signal: req.signal,
        });
        let r = await gen.next();
        while (!r.done) {
          send(r.value);
          r = await gen.next();
        }
        const res = r.value;
        const id = await saveMessage(ctx.organizationId, sessionId, {
          role: "assistant",
          content: res.text || "I could not produce an answer.",
          sources: res.sources,
          chart: res.chart,
          actionId: res.actionId,
          engine: res.engine,
        });
        send({
          type: "suggestions",
          items: suggestFollowUps(res.toolsUsed, ctx.role, Boolean(ctx.employeeId)),
        });
        send({
          type: "done",
          engine: res.engine,
          model: res.model,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          messageId: id,
        });
        await usage(
          res.degraded || res.engine === "fallback" ? "fallback" : "ok",
          res.model,
          res.inputTokens,
          res.outputTokens,
        );
      } catch {
        send({ type: "error", message: "Something went wrong. Please try again." });
        await usage("error");
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-session-id": sessionId,
      "x-accel-buffering": "no",
    },
  });
}
