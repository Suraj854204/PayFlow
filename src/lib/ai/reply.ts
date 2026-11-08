import "server-only";
import { runAgent, type AgentResult } from "./agent";
import type { ToolEnv } from "./tools";
import type { AgentEvent, ChatModel, Turn } from "./types";

export interface ReplyResult extends AgentResult {
  model: string;
  engine: "model" | "fallback";
  /** True when the primary model failed and the built-in engine answered instead. */
  degraded: boolean;
}

/**
 * Runs the agent with the primary model. If it fails before saying anything, the built-in engine
 * answers instead; if it fails midway, what was said is kept with a note. PayBot never goes silent.
 */
export async function* runWithFallback(
  primary: ChatModel,
  fallback: ChatModel,
  base: { system: string; history: Turn[]; env: ToolEnv; signal?: AbortSignal },
): AsyncGenerator<AgentEvent, ReplyResult> {
  let partial = "";
  try {
    const gen = runAgent({ ...base, model: primary });
    let r = await gen.next();
    while (!r.done) {
      if (r.value.type === "text") partial += r.value.delta;
      yield r.value;
      r = await gen.next();
    }
    return { ...r.value, model: primary.name, engine: primary.engine, degraded: false };
  } catch (e) {
    if (primary.engine === "fallback") throw e;
    if (partial) {
      const note = "\n\n_The AI service was interrupted, so this answer may be incomplete._";
      yield { type: "text", delta: note };
      return {
        text: partial + note,
        sources: [],
        chart: null,
        actionId: null,
        toolsUsed: [],
        inputTokens: 0,
        outputTokens: 0,
        model: primary.name,
        engine: primary.engine,
        degraded: true,
      };
    }
    const gen = runAgent({ ...base, model: fallback });
    let r = await gen.next();
    while (!r.done) {
      yield r.value;
      r = await gen.next();
    }
    return { ...r.value, model: fallback.name, engine: "fallback", degraded: true };
  }
}
