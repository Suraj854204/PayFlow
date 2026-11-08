import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { embedTexts, toVectorLiteral } from "./embed";

export interface PolicyHit {
  chunkId: string;
  documentId: string;
  title: string;
  page: number;
  content: string;
  score: number;
}

let vectorCol: boolean | null = null;
/** Whether the optional pgvector column exists in this database. */
export async function hasVectorColumn(tx: Tx): Promise<boolean> {
  if (vectorCol !== null) return vectorCol;
  const r = await tx.execute(
    sql`select 1 from information_schema.columns where table_name = 'policy_chunks' and column_name = 'embedding'`,
  );
  vectorCol = r.rows.length > 0;
  return vectorCol;
}

/**
 * Finds passages for a question: by meaning (pgvector cosine distance) when vectors and a Gemini
 * key exist, otherwise by Postgres full-text rank. The query only ever sees this organisation's
 * policies (row-level security plus an explicit filter).
 */
export async function searchPolicies(
  tx: Tx,
  organizationId: string,
  query: string,
  limit = 4,
): Promise<{ hits: PolicyHit[]; mode: "semantic" | "keyword" }> {
  if (await hasVectorColumn(tx)) {
    const v = await embedTexts([query], "RETRIEVAL_QUERY");
    if (v) {
      const lit = toVectorLiteral(v[0]);
      const r = await tx.execute(sql`
        select c.id, c.document_id, d.title, c.page, c.content,
               1 - (c.embedding <=> ${lit}::vector) as score
          from policy_chunks c join policy_documents d on d.id = c.document_id
         where c.organization_id = ${organizationId} and c.embedding is not null
         order by c.embedding <=> ${lit}::vector
         limit ${limit}`);
      if (r.rows.length) return { hits: r.rows.map(row), mode: "semantic" };
    }
  }
  const tokens = keywords(query);
  if (tokens.length === 0) return { hits: [], mode: "keyword" };
  const r = await tx.execute(sql`
    select c.id, c.document_id, d.title, c.page, c.content,
           ts_rank(to_tsvector('english', c.content), to_tsquery('english', ${tokens.join(" | ")})) as score
      from policy_chunks c join policy_documents d on d.id = c.document_id
     where c.organization_id = ${organizationId}
       and to_tsvector('english', c.content) @@ to_tsquery('english', ${tokens.join(" | ")})
     order by score desc
     limit ${limit * 3}`);
  const sig = significant(tokens);
  const need = Math.max(1, Math.ceil(sig.length / 2));
  const hits = r.rows
    .map(row)
    .filter((h) => coverage(h.content, sig) >= need)
    .slice(0, limit);
  return { hits, mode: "keyword" };
}

const GENERIC = new Set([
  "policy",
  "policies",
  "company",
  "what",
  "how",
  "much",
  "many",
  "does",
  "have",
  "about",
  "tell",
  "rule",
  "rules",
  "regarding",
  "there",
  "any",
  "our",
  "the",
  "and",
  "for",
  "can",
  "get",
  "need",
]);
/** Distinct lowercase words of 3+ letters from a question, safe to put in a tsquery. */
export function keywords(q: string): string[] {
  return [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 12);
}
const significant = (t: string[]) => {
  const s = t.filter((x) => !GENERIC.has(x));
  return s.length ? s : t;
};
/** How many of the words appear in the passage, allowing simple endings (notice/notices). */
function coverage(text: string, words: string[]): number {
  const low = text.toLowerCase();
  return words.filter((w) => low.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
}

function row(x: Record<string, unknown>): PolicyHit {
  return {
    chunkId: String(x.id),
    documentId: String(x.document_id),
    title: String(x.title),
    page: Number(x.page),
    content: String(x.content),
    score: Number(x.score),
  };
}
