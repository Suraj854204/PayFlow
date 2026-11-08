import { Generator } from "@/components/generators/generator";
import { requirePagePermission } from "@/lib/auth/context";
import { GEN_KINDS, type GenKind } from "@/lib/gen/schema";
import { can } from "@/lib/rbac";

export const metadata = { title: "Document generators" };
export const dynamic = "force-dynamic";

export default async function GeneratorsPage() {
  const ctx = await requirePagePermission("ai:use");
  const hr = can(ctx.role, "employees:write");
  const kinds: GenKind[] = GEN_KINDS.filter((k) =>
    k === "announcement_email" ? can(ctx.role, "announcements:manage") : hr,
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Document generators</h1>
        <p className="text-muted-foreground text-sm">
          Offer and appointment letters, job descriptions and announcement emails.
        </p>
      </div>
      {kinds.length ? (
        <Generator kinds={kinds} />
      ) : (
        <p className="text-muted-foreground text-sm">Your role does not have any generators.</p>
      )}
    </div>
  );
}
