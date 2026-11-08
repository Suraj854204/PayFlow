import "server-only";
import { toolEnv, executeTool, toolLabel, toolsFor, type ToolEnv } from "./tools";
import { estimateTokens } from "./guard";
import type { AgentEvent, ChatModel, ModelChunk, ToolCall, Turn } from "./types";
import type { ChatChart, ChatSource } from "@/lib/db/schema";

export const MAX_STEPS = 4;
export const MAX_TOOL_CALLS = 6;

export interface AgentResult {
  text: string;
  sources: ChatSource[];
  chart: ChatChart | null;
  /** The action card proposed in this reply, if any. */
  actionId: string | null;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Runs one assistant reply: ask the model, execute any tool calls it makes (each re-checked against
 * the user's permissions), feed the results back, and repeat until it answers in text. Yields events
 * for the UI as they happen and returns the final result.
 */
export async function* runAgent(opts: {
  model: ChatModel;
  system: string;
  history: Turn[];
  env: ToolEnv;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent, AgentResult> {
  const tools = toolsFor(opts.env.ctx);
  const turns: Turn[] = [...opts.history];
  const sources: ChatSource[] = [];
  const toolsUsed: string[] = [];
  let chart: ChatChart | null = null;
  let actionId: string | null = null;
  let text = "";
  let calls = 0;
  let inTok =
    estimateTokens(opts.system) +
    turns.reduce(
      (s, t) =>
        s +
        estimateTokens(
          t.role === "user" ? t.text : t.role === "model" ? t.text : JSON.stringify(t.results),
        ),
      0,
    );
  let outTok = 0;
  let reportedUsage = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    let stepText = "";
    let pending: ToolCall[] = [];
    let raw: unknown[] | undefined;
    const withTools = calls < MAX_TOOL_CALLS ? tools : [];
    for await (const chunk of opts.model.stream({
      system: opts.system,
      turns,
      tools: withTools,
      signal: opts.signal,
    }) as AsyncIterable<ModelChunk>) {
      if (chunk.type === "text") {
        stepText += chunk.delta;
        yield { type: "text", delta: chunk.delta };
      } else if (chunk.type === "calls") {
        pending = chunk.calls;
        raw = chunk.raw;
      } else {
        if (!reportedUsage) {
          inTok = 0;
          outTok = 0;
          reportedUsage = true;
        }
        inTok += chunk.inputTokens;
        outTok += chunk.outputTokens;
      }
    }
    text += stepText;
    if (!reportedUsage) outTok += estimateTokens(stepText);
    if (pending.length === 0) break;

    turns.push({ role: "model", text: stepText, calls: pending, raw });
    const results: {
      name: string;
      response: Record<string, unknown>;
      status: "ok" | "denied" | "error";
    }[] = [];
    for (const call of pending.slice(0, Math.max(0, MAX_TOOL_CALLS - calls))) {
      calls++;
      yield { type: "tool", name: call.name, label: toolLabel(call.name), status: "running" };
      const r = await executeTool(opts.env, call.name, call.args);
      results.push({ name: call.name, response: r.response, status: r.status });
      yield {
        type: "tool",
        name: call.name,
        label: toolLabel(call.name),
        status: r.status === "ok" ? "done" : r.status,
      };
      if (r.status === "ok") {
        toolsUsed.push(call.name);
        for (const s of r.sources)
          if (!sources.some((x) => x.href === s.href && x.title === s.title)) sources.push(s);
        if (r.action) {
          actionId = r.action.id;
          yield { type: "action", card: r.action };
        }
        if (r.chart) {
          chart = r.chart;
          yield { type: "chart", chart: r.chart };
        }
      }
    }
    turns.push({ role: "tool", results });
    if (sources.length) yield { type: "sources", sources };
    // Models occasionally keep calling tools; after the cap they get no tools and must answer.
  }
  return { text, sources, chart, actionId, toolsUsed, inputTokens: inTok, outputTokens: outTok };
}

export { toolEnv };
