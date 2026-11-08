"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { notifications } from "@/lib/db/schema";

/** Marks one of the signed-in user's own notifications as read (or all of them). */
export async function markNotificationsReadAction(id: string | null) {
  return runAction("org:read", async ({ ctx, tx }) => {
    const own = and(
      eq(notifications.organizationId, ctx.organizationId),
      eq(notifications.userId, ctx.user.id),
      isNull(notifications.readAt),
    );
    const where = id ? and(own, eq(notifications.id, z.string().uuid().parse(id))) : own;
    await tx.update(notifications).set({ readAt: new Date() }).where(where);
    return null;
  });
}
