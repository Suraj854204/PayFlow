import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { db, withTenant } from "@/lib/db";
import { payments, webhookEvents } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { settleRunIfComplete } from "@/lib/payments/dispatch";
import { verifySignature } from "@/lib/payments/signature";

export const runtime = "nodejs";

const STATUS: Record<string, "processing" | "processed" | "failed" | "reversed"> = {
  "payout.processed": "processed",
  "payout.processing": "processing",
  "payout.initiated": "processing",
  "payout.queued": "processing",
  "payout.failed": "failed",
  "payout.rejected": "failed",
  "payout.reversed": "reversed",
};

export async function POST(req: Request) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  const raw = await req.text(); // the signature covers the exact raw body
  if (!verifySignature(raw, req.headers.get("x-razorpay-signature"), secret))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let evt: {
    event?: string;
    payload?: { payout?: { entity?: { id?: string; failure_reason?: string | null } } };
  };
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }
  const eventId = req.headers.get("x-razorpay-event-id");
  const type = evt.event ?? "";
  const entity = evt.payload?.payout?.entity;
  const next = STATUS[type];
  if (!eventId || !next || !entity?.id) return NextResponse.json({ ok: true, ignored: true });

  // Deduplicate: a redelivered event is acknowledged without being applied again.
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider: "razorpay", eventId, eventType: type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  const found = await db.execute(sql`select payment_org_by_ref(${entity.id}) as org`);
  const orgId = (found.rows[0] as { org: string | null } | undefined)?.org;
  if (!orgId) return NextResponse.json({ ok: true, unknown: true });

  await withTenant(orgId, async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.providerRef, entity.id!));
    if (!p) return;
    // Never move a settled payment backwards because of an out-of-order event.
    if (p.status === "processed" && next === "processing") return;
    await tx
      .update(payments)
      .set({
        status: next,
        failureReason:
          next === "failed" || next === "reversed" ? (entity.failure_reason ?? type) : null,
        processedAt: next === "processed" ? new Date() : p.processedAt,
      })
      .where(eq(payments.id, p.id));
    await writeAudit(tx, {
      organizationId: orgId,
      actorUserId: null,
      actorRole: "system",
      action: `payment.${next}`,
      entityType: "payment",
      entityId: p.id,
      oldValues: { status: p.status },
      newValues: { status: next },
      metadata: { provider: "razorpay", event: type },
    });
    if (p.runId) await settleRunIfComplete(tx, orgId, p.runId);
  });
  return NextResponse.json({ ok: true });
}
