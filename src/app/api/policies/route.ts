import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { policyChunks, policyDocuments } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { rateLimit } from "@/lib/rate-limit";
import { chunkPages } from "@/lib/policy/chunk";
import { embedTexts, toVectorLiteral } from "@/lib/policy/embed";
import { extractPages, PolicyFileError } from "@/lib/policy/extract";
import { hasVectorColumn } from "@/lib/policy/search";

export const runtime = "nodejs";
const json = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Upload a policy: extract text, split into passages, embed when possible, store. HR only. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return json("Please sign in.", 401);
  if (!can(ctx.role, "policies:manage")) return json("You do not have permission to do that.", 403);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return json("Bad origin.", 403);
  if (!(await rateLimit("policy-upload", ctx.user.id, 10, "1 m")).success)
    return json("Too many uploads. Wait a moment.", 429);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json("Choose a file to upload.", 400);
  const title =
    String(form?.get("title") ?? "")
      .trim()
      .slice(0, 120) || file.name.replace(/\.[^.]+$/, "").slice(0, 120);

  let pages: string[];
  try {
    pages = await extractPages(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
  } catch (e) {
    if (e instanceof PolicyFileError) return json(e.message, 400);
    return json("The file could not be processed.", 400);
  }
  const chunks = chunkPages(pages);
  if (chunks.length === 0) return json("No readable text found in that file.", 400);
  const vectors = await embedTexts(
    chunks.map((c) => c.content),
    "RETRIEVAL_DOCUMENT",
  );

  const id = await withTenant(ctx.organizationId, async (tx) => {
    const withVec = Boolean(vectors) && (await hasVectorColumn(tx));
    const [doc] = await tx
      .insert(policyDocuments)
      .values({
        organizationId: ctx.organizationId,
        title,
        filename: file.name.slice(0, 200),
        pages: pages.length,
        chunkCount: chunks.length,
        indexMode: withVec ? "embedded" : "keyword",
        uploadedBy: ctx.user.id,
      })
      .returning({ id: policyDocuments.id });
    const rows = await tx
      .insert(policyChunks)
      .values(
        chunks.map((c) => ({
          organizationId: ctx.organizationId,
          documentId: doc.id,
          idx: c.idx,
          page: c.page,
          content: c.content,
        })),
      )
      .returning({ id: policyChunks.id, idx: policyChunks.idx });
    if (withVec && vectors)
      for (const r of rows)
        await tx.execute(
          sql`update policy_chunks set embedding = ${toVectorLiteral(vectors[r.idx])}::vector where id = ${r.id}`,
        );
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "policy.uploaded",
      entityType: "policy_document",
      entityId: doc.id,
      newValues: {
        title,
        pages: pages.length,
        chunks: chunks.length,
        indexMode: withVec ? "embedded" : "keyword",
      },
    });
    return doc.id;
  });
  return NextResponse.json({ id, chunks: chunks.length, pages: pages.length });
}
