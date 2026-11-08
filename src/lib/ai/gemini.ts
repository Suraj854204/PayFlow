import "server-only";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import type { ChatModel, ModelChunk, ToolCall, Turn } from "./types";

/** Converts the agent's turns to Gemini contents. Raw model parts are replayed verbatim so thought signatures survive. */
export function toContents(turns: Turn[]): Content[] {
  const out: Content[] = [];
  for (const t of turns) {
    if (t.role === "user") out.push({ role: "user", parts: [{ text: t.text }] });
    else if (t.role === "model") {
      const parts: Part[] = t.raw?.length
        ? (t.raw as Part[])
        : [
            ...(t.text ? [{ text: t.text }] : []),
            ...t.calls.map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.args } })),
          ];
      out.push({ role: "model", parts });
    } else {
      out.push({
        role: "user",
        parts: t.results.map((r) => ({
          functionResponse: { name: r.name, response: { status: r.status, ...r.response } },
        })),
      });
    }
  }
  return out;
}

export class ProviderError extends Error {}

export function geminiModel(apiKey: string, model: string): ChatModel {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: model,
    engine: "model",
    async *stream({ system, turns, tools, signal }): AsyncGenerator<ModelChunk> {
      let stream;
      try {
        stream = await ai.models.generateContentStream({
          model,
          contents: toContents(turns),
          config: {
            systemInstruction: system,
            temperature: 0.2,
            maxOutputTokens: 1200,
            abortSignal: signal,
            ...(tools.length
              ? {
                  tools: [
                    {
                      functionDeclarations: tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parametersJsonSchema: t.parameters,
                      })),
                    },
                  ],
                }
              : {}),
          },
        });
      } catch (e) {
        throw new ProviderError(e instanceof Error ? e.message : "Gemini request failed");
      }
      const calls: ToolCall[] = [];
      const raw: unknown[] = [];
      let usage: { i: number; o: number } | null = null;
      try {
        for await (const chunk of stream) {
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            raw.push(p);
            if (p.text && !p.thought) yield { type: "text", delta: p.text };
            if (p.functionCall?.name)
              calls.push({
                id: p.functionCall.id ?? `${p.functionCall.name}-${calls.length}`,
                name: p.functionCall.name,
                args: (p.functionCall.args ?? {}) as Record<string, unknown>,
              });
          }
          if (chunk.usageMetadata)
            usage = {
              i: chunk.usageMetadata.promptTokenCount ?? 0,
              o:
                (chunk.usageMetadata.candidatesTokenCount ?? 0) +
                (chunk.usageMetadata.thoughtsTokenCount ?? 0),
            };
        }
      } catch (e) {
        throw new ProviderError(e instanceof Error ? e.message : "Gemini stream failed");
      }
      if (calls.length) yield { type: "calls", calls, raw };
      if (usage) yield { type: "usage", inputTokens: usage.i, outputTokens: usage.o };
    },
  };
}
