import "server-only";
import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 768;

/** Embeds texts with Gemini. Returns null when no key is set or the call fails: callers fall back to keyword search. */
export async function embedTexts(
  texts: string[],
  task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][] | null> {
  if (!env.GEMINI_API_KEY || texts.length === 0) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) {
      const res = await ai.models.embedContent({
        model: EMBED_MODEL,
        contents: texts.slice(i, i + 50),
        config: { taskType: task, outputDimensionality: EMBED_DIMS },
      });
      const vecs = res.embeddings?.map((e) => e.values ?? []) ?? [];
      if (
        vecs.length !== texts.slice(i, i + 50).length ||
        vecs.some((v) => v.length !== EMBED_DIMS)
      )
        return null;
      out.push(...vecs);
    }
    return out;
  } catch {
    return null;
  }
}

/** pgvector text literal, e.g. "[0.1,0.2]". */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;
