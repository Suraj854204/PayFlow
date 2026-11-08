import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { privacyRequests } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { buildPersonalExport } from "@/lib/privacy/export";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Self-service data export (DPDP right of access / GDPR Art. 15). Only ever the caller's own data. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rl = await rateLimit("privacy-export", ctx.user.id, 5, "1 h");
  if (!rl.success)
    return NextResponse.json({ error: "Too many exports. Try again later." }, { status: 429 });

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const out = await buildPersonalExport(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      employeeId: ctx.employeeId,
      email: ctx.user.email,
    });
    await tx.insert(privacyRequests).values({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      employeeId: ctx.employeeId,
      kind: "export",
      status: "completed",
      decidedAt: new Date(),
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      actorRole: ctx.role,
      action: "privacy.export_downloaded",
      entityType: "user",
      entityId: ctx.user.id,
    });
    return out;
  });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="my-payflow-data.json"',
      "cache-control": "no-store",
    },
  });
}
