import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getContext } from "@/lib/auth/context";
import { encrypt } from "@/lib/crypto";
import { withTenant } from "@/lib/db";
import { documentExtractions, employees } from "@/lib/db/schema";
import { tokensUsedToday, logUsage } from "@/lib/ai/usage";
import { DOC_KINDS } from "@/lib/docai/fields";
import { extractDocument, MAX_DOC_BYTES, sniffMime } from "@/lib/docai/extract";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";

export const runtime = "nodejs";
const json = (error: string, status: number) => NextResponse.json({ error }, { status });
const form = z.object({ employeeId: z.string().uuid(), kind: z.enum(DOC_KINDS) });

/** Upload a document: read it with AI when possible, then park the result for human verification. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return json("Please sign in.", 401);
  if (!can(ctx.role, "employees:write")) return json("You do not have permission to do that.", 403);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return json("Bad origin.", 403);
  if (!(await rateLimit("doc-ai", ctx.user.id, 10, "1 m")).success)
    return json("Too many uploads. Wait a moment.", 429);

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const meta = form.safeParse({ employeeId: fd?.get("employeeId"), kind: fd?.get("kind") });
  if (!(file instanceof File) || !meta.success)
    return json("Choose an employee, a type and a file.", 400);
  if (file.size === 0 || file.size > MAX_DOC_BYTES)
    return json("The file must be under 4 MB.", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) return json("Upload a JPG, PNG, WebP or PDF.", 400);

  const used = await withTenant(ctx.organizationId, async (tx) => {
    const [e] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.id, meta.data.employeeId),
          eq(employees.organizationId, ctx.organizationId),
          isNull(employees.deletedAt),
        ),
      );
    if (!e) return null;
    return tokensUsedToday(tx, ctx.organizationId, ctx.user.id);
  });
  if (used === null) return json("Employee not found.", 404);

  // Over the daily AI budget: skip the model and let the reviewer type the fields in.
  const ex =
    used >= env.AI_DAILY_TOKEN_LIMIT
      ? {
          fields: Object.fromEntries(
            (await import("@/lib/docai/fields")).FIELD_DEFS[meta.data.kind].map((f) => [f.key, ""]),
          ),
          engine: "manual" as const,
          inputTokens: 0,
          outputTokens: 0,
          note: "Today's AI limit is reached. Enter the fields by hand.",
        }
      : await extractDocument(meta.data.kind, bytes, mime);

  const id = await withTenant(ctx.organizationId, async (tx) => {
    const [row] = await tx
      .insert(documentExtractions)
      .values({
        organizationId: ctx.organizationId,
        employeeId: meta.data.employeeId,
        kind: meta.data.kind,
        filename: file.name.slice(0, 200),
        fieldsEnc: encrypt(JSON.stringify(ex.fields)),
        engine: ex.engine,
        note: ex.note ?? null,
        createdBy: ctx.user.id,
      })
      .returning({ id: documentExtractions.id });
    if (env.GEMINI_API_KEY)
      await logUsage(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        feature: "document_ai",
        model: env.GEMINI_MODEL,
        inputTokens: ex.inputTokens,
        outputTokens: ex.outputTokens,
        status: ex.engine === "model" ? "ok" : "fallback",
      });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "document.uploaded",
      entityType: "document_extraction",
      entityId: row.id,
      newValues: { kind: meta.data.kind, employeeId: meta.data.employeeId, engine: ex.engine },
    });
    return row.id;
  });
  return NextResponse.json({ id, engine: ex.engine });
}
