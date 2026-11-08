import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { webhookDeliveries, webhookEndpoints } from "@/lib/db/schema";

/**
 * Queues webhook deliveries inside the caller's transaction, so the event exists exactly when the
 * business change committed. Delivery happens on the next sweep (within minutes) because the caller
 * may be a payment webhook or a transaction we must not slow down.
 */
export async function queueWebhookEvent(
  tx: Tx,
  orgId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const eps = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, orgId),
        eq(webhookEndpoints.enabled, true),
        isNull(webhookEndpoints.deletedAt),
        sql`${event} = any(${webhookEndpoints.events})`,
      ),
    );
  for (const ep of eps)
    await tx
      .insert(webhookDeliveries)
      .values({ organizationId: orgId, endpointId: ep.id, event, payload });
  return eps.length;
}
