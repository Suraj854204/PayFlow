import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { DeletePolicyButton } from "@/components/policies/delete-button";
import { PolicyUploadForm } from "@/components/policies/upload-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { policyDocuments } from "@/lib/db/schema";
import { can } from "@/lib/rbac";

export const metadata = { title: "HR policies" };
export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const ctx = await requirePagePermission("policies:read");
  const manage = can(ctx.role, "policies:manage");
  const docs = await withTenant(ctx.organizationId, (tx) =>
    tx
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.organizationId, ctx.organizationId))
      .orderBy(desc(policyDocuments.createdAt)),
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HR policies</h1>
        <p className="text-muted-foreground text-sm">
          PayBot answers policy questions from these documents and cites the page.
        </p>
      </div>
      {manage && (
        <Card>
          <CardHeader>
            <CardTitle>Add a policy</CardTitle>
            <CardDescription>
              Text is extracted, split into passages and indexed for search.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PolicyUploadForm />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-3">
              <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <Link href={`/policies/${d.id}`} className="min-w-0 flex-1 hover:underline">
                <p className="truncate font-medium">{d.title}</p>
                <p className="text-muted-foreground text-xs">
                  {d.pages} page{d.pages === 1 ? "" : "s"} · {d.chunkCount} passages · {d.filename}
                </p>
              </Link>
              <Badge tone={d.indexMode === "embedded" ? "primary" : "neutral"}>
                {d.indexMode === "embedded" ? "Semantic search" : "Keyword search"}
              </Badge>
              {manage && <DeletePolicyButton id={d.id} title={d.title} />}
            </div>
          ))}
          {docs.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {manage
                ? "No policies yet. Upload your first one above."
                : "No policies have been published yet."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
