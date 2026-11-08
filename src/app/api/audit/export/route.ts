import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { queryAudit, writeAudit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { csvSafe } from "@/lib/validation/hr";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "audit:read"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const filter = {
    action: q.get("action") ?? undefined,
    entityType: q.get("entity") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
  };
  const rows = await withTenant(ctx.organizationId, async (tx) => {
    const r = await queryAudit(tx, ctx.organizationId, filter, 5000);
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "audit.exported",
      entityType: "audit_log",
      metadata: { filter, rows: r.length },
    });
    return r;
  });
  const header = [
    "seq",
    "time",
    "action",
    "entity_type",
    "entity_id",
    "actor_role",
    "old_values",
    "new_values",
    "hash",
  ];
  const lines = rows.map((r) =>
    [
      r.seq,
      r.createdAt.toISOString(),
      r.action,
      r.entityType,
      r.entityId ?? "",
      r.actorRole ?? "",
      JSON.stringify(r.oldValues ?? null),
      JSON.stringify(r.newValues ?? null),
      r.hash,
    ]
      .map(csvSafe)
      .join(","),
  );
  return new NextResponse([header.join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit-log.csv"',
      "cache-control": "private, no-store",
    },
  });
}
