import type { ChatChart, ChatSource } from "@/lib/db/schema";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface ToolOutcome {
  name: string;
  /** What the model is told. Already sanitised. */
  response: Record<string, unknown>;
  status: "ok" | "denied" | "error";
}

/** One step of the conversation as the agent loop sees it. `raw` keeps provider-specific parts for replay. */
export type Turn =
  | { role: "user"; text: string }
  | { role: "model"; text: string; calls: ToolCall[]; raw?: unknown[] }
  | { role: "tool"; results: ToolOutcome[] };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export type ModelChunk =
  | { type: "text"; delta: string }
  | { type: "calls"; calls: ToolCall[]; raw?: unknown[] }
  | { type: "usage"; inputTokens: number; outputTokens: number };

export interface ChatModel {
  /** "gemini-2.5-flash", or "fallback". */
  readonly name: string;
  readonly engine: "model" | "fallback";
  stream(input: {
    system: string;
    turns: Turn[];
    tools: ToolSpec[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelChunk>;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string; status: "running" | "done" | "denied" | "error" }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "chart"; chart: ChatChart }
  | { type: "action"; card: ActionCard }
  | { type: "suggestions"; items: string[] }
  | {
      type: "done";
      engine: "model" | "fallback";
      model: string;
      inputTokens: number;
      outputTokens: number;
      messageId?: string;
    }
  | { type: "error"; message: string };

/** A proposed action as the UI shows it. Parameters never leave the server. */
export interface ActionCard {
  id: string;
  kind: string;
  title: string;
  summary: string;
  changes: { label: string; before?: string; after: string }[];
  warnings: string[];
  destructive: boolean;
  status: "pending" | "executing" | "executed" | "failed" | "cancelled" | "expired";
  expiresAt: string;
  result?: string | null;
}
