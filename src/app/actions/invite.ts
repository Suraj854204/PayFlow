"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees, invitations, memberships } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { ACTIVE_ORG_COOKIE, getSessionUser } from "@/lib/auth/context";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action";
import { rateLimit } from "@/lib/rate-limit";

const tokenSchema = z.string().min(20).max(80);

/** Accepts an invitation for the signed-in user. The email on the invite must match the account. */
export async function acceptInviteAction(
  token: unknown,
): Promise<ActionResult<{ organizationId: string }>> {
  try {
    const user = await getSessionUser();
    if (!user) throw new UserFacingError("Please sign in first.");
    const t = tokenSchema.parse(token);
    const rl = await rateLimit("invite-accept", user.id, 10, "10 m");
    if (!rl.success) throw new UserFacingError("Too many attempts. Try again in a few minutes.");
    const hash = createHash("sha256").update(t).digest("hex");

    const orgId = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.invite_hash', ${hash}, true)`);
      const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hash));
      if (!inv) throw new UserFacingError("This invitation link is not valid.");
      if (inv.acceptedAt) throw new UserFacingError("This invitation was already used.");
      if (inv.expiresAt < new Date())
        throw new UserFacingError("This invitation has expired. Ask your admin for a new one.");
      if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new UserFacingError(
          `This invitation is for ${inv.email}. Sign in with that email address.`,
        );
      }

      await tx.execute(sql`select set_config('app.current_org', ${inv.organizationId}, true)`);
      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, inv.organizationId), eq(memberships.userId, user.id)),
        );
      if (!existing) {
        await tx.insert(memberships).values({
          organizationId: inv.organizationId,
          userId: user.id,
          role: inv.role,
          employeeId: inv.employeeId,
        });
      }
      if (inv.employeeId) {
        await tx
          .update(employees)
          .set({ userId: user.id })
          .where(
            and(
              eq(employees.id, inv.employeeId),
              eq(employees.organizationId, inv.organizationId),
              isNull(employees.userId),
            ),
          );
      }
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, inv.id));
      await writeAudit(tx, {
        organizationId: inv.organizationId,
        actorUserId: user.id,
        actorRole: inv.role,
        action: "member.joined",
        entityType: "membership",
        entityId: user.id,
        newValues: { role: inv.role, email: user.email },
      });
      return inv.organizationId;
    });

    (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { organizationId: orgId } };
  } catch (err) {
    return toActionError(err);
  }
}
