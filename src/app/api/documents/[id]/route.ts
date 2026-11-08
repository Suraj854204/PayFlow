import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { can } from "@/lib/rbac";
import { withTenant } from "@/lib/db";
import { employeeDocuments } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "employees:write"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await withTenant(ctx.organizationId, async (tx) => {
    const [d] = await tx
      .select()
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.id, parsed.data),
          eq(employeeDocuments.organizationId, ctx.organizationId),
          isNull(employeeDocuments.deletedAt),
        ),
      );
    if (d) {
      await writeAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.user.id,
        actorRole: ctx.role,
        action: "employee.document_downloaded",
        entityType: "employee",
        entityId: d.employeeId,
        newValues: { fileName: d.fileName },
      });
    }
    return d;
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${doc.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
