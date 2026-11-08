import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { policyChunks, policyDocuments } from "@/lib/db/schema";

export const metadata = { title: "Policy" };
export const dynamic = "force-dynamic";

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("policies:read");
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) notFound();
  const data = await withTenant(ctx.organizationId, async (tx) => {
    const [doc] = await tx
      .select()
      .from(policyDocuments)
      .where(
        and(
          eq(policyDocuments.id, id.data),
          eq(policyDocuments.organizationId, ctx.organizationId),
        ),
      );
    if (!doc) return null;
    const chunks = await tx
      .select()
      .from(policyChunks)
      .where(eq(policyChunks.documentId, doc.id))
      .orderBy(asc(policyChunks.idx));
    return { doc, chunks };
  });
  if (!data) notFound();
  const byPage = new Map<number, string[]>();
  for (const c of data.chunks) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c.content]);
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/policies"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Policies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{data.doc.title}</h1>
      </div>
      {[...byPage.entries()].map(([page, parts]) => (
        <section key={page} id={`page-${page}`} className="bg-card rounded-2xl border p-4">
          <h2 className="text-muted-foreground mb-2 text-xs font-medium">Page {page}</h2>
          <p className="text-sm leading-relaxed whitespace-pre-line">{parts.join("\n\n")}</p>
        </section>
      ))}
    </div>
  );
}
