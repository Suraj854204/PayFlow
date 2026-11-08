"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { announcements, memberships } from "@/lib/db/schema";
import { notify } from "@/lib/notify";

const postSchema = z.object({
  title: z.string().trim().min(1, "Add a title.").max(120),
  body: z.string().trim().min(1, "Write the announcement.").max(2000),
  pinned: z.boolean().default(false),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  notifyAll: z.boolean().default(false),
});

export async function postAnnouncementAction(input: unknown) {
  return runAction(
    "announcements:manage",
    async ({ ctx, tx, audit }) => {
      const d = postSchema.parse(input);
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      if (d.expiresOn && d.expiresOn <= today)
        throw new UserFacingError("The expiry date must be in the future.");
      const [a] = await tx
        .insert(announcements)
        .values({
          organizationId: ctx.organizationId,
          title: d.title,
          body: d.body,
          pinned: d.pinned,
          expiresOn: d.expiresOn,
          createdBy: ctx.user.id,
        })
        .returning();
      if (d.notifyAll) {
        const people = await tx
          .select({ u: memberships.userId })
          .from(memberships)
          .where(
            and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.isActive, true)),
          );
        for (const p of people)
          await notify(tx, ctx.organizationId, {
            userId: p.u,
            type: "announcement",
            title: d.title,
            href: "/dashboard",
          });
      }
      await audit({
        action: "announcement.posted",
        entityType: "announcement",
        entityId: a.id,
        newValues: { title: d.title, pinned: d.pinned, notifyAll: d.notifyAll },
      });
      return { id: a.id };
    },
    ["/dashboard"],
  );
}

export async function deleteAnnouncementAction(id: string) {
  return runAction(
    "announcements:manage",
    async ({ ctx, tx, audit }) => {
      const uuid = z.string().uuid().parse(id);
      const del = await tx
        .delete(announcements)
        .where(
          and(eq(announcements.id, uuid), eq(announcements.organizationId, ctx.organizationId)),
        )
        .returning();
      if (del.length === 0) throw new UserFacingError("Announcement not found.");
      await audit({
        action: "announcement.deleted",
        entityType: "announcement",
        entityId: uuid,
        oldValues: { title: del[0].title },
      });
      return null;
    },
    ["/dashboard"],
  );
}
