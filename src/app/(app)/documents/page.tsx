import { and, asc, eq, isNull } from "drizzle-orm";
import { DocumentUploadForm } from "@/components/documents/upload-form";
import { ReviewCard } from "@/components/documents/review-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadExtractionsAction } from "@/app/actions/documents";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees } from "@/lib/db/schema";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const ctx = await requirePagePermission("employees:write");
  const emps = await withTenant(ctx.organizationId, (tx) =>
    tx
      .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
      .from(employees)
      .where(and(eq(employees.organizationId, ctx.organizationId), isNull(employees.deletedAt)))
      .orderBy(asc(employees.firstName)),
  );
  const res = await loadExtractionsAction();
  const docs = res.ok ? res.data : [];
  const review = docs.filter((d) => d.status === "review");
  const done = docs.filter((d) => d.status !== "review");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-muted-foreground text-sm">
          Upload a PAN, Aadhaar, bank proof or resume. AI reads it; a person verifies before
          anything is saved.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>
            The file is sent to Gemini to be read and is not stored. Extracted values are encrypted
            until verified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentUploadForm
            employees={emps.map((e) => ({ id: e.id, name: `${e.first} ${e.last ?? ""}`.trim() }))}
          />
        </CardContent>
      </Card>
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Waiting for verification ({review.length})</h2>
        {review.map((d) => (
          <ReviewCard key={d.id} doc={d} />
        ))}
        {review.length === 0 && <p className="text-muted-foreground text-sm">Nothing waiting.</p>}
      </div>
      {done.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Recently decided</h2>
          {done.slice(0, 10).map((d) => (
            <ReviewCard key={d.id} doc={d} />
          ))}
        </div>
      )}
    </div>
  );
}
