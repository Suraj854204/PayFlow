"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  ACTIVE_ORG_COOKIE,
  getSessionUser,
  listCompanies,
  requireActionPermission,
} from "@/lib/auth/context";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action";
import { slugify } from "@/lib/slug";
import { seedSalaryDefaults } from "@/lib/org-defaults";
import { seedLeaveDefaults } from "@/lib/workforce/leave-balance";

const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Company name is too short").max(120),
  state: z.string().trim().max(60).optional(),
});

async function setActiveOrg(orgId: string) {
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Creates a company and makes the current user its Super Admin. Works for first and additional companies. */
export async function createCompanyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getSessionUser();
    if (!user) throw new UserFacingError("Please sign in first.");
    const data = createCompanySchema.parse(input);

    // Generate the id up front so RLS (which compares to app.current_org) accepts the insert.
    const orgId = randomUUID();
    const baseSlug = slugify(data.name) || "company";
    const slug = `${baseSlug}-${orgId.slice(0, 6)}`;

    await withTenant(orgId, async (tx) => {
      await tx
        .insert(organizations)
        .values({ id: orgId, name: data.name, slug, state: data.state ?? null });
      await tx.insert(memberships).values({
        organizationId: orgId,
        userId: user.id,
        role: "super_admin",
      });
      await seedSalaryDefaults(tx, orgId);
      await seedLeaveDefaults(tx, orgId);
      await writeAudit(tx, {
        organizationId: orgId,
        actorUserId: user.id,
        actorRole: "super_admin",
        action: "organization.created",
        entityType: "organization",
        entityId: orgId,
        newValues: { name: data.name, slug },
      });
    });

    await setActiveOrg(orgId);
    revalidatePath("/", "layout");
    return { ok: true, data: { id: orgId } };
  } catch (err) {
    return toActionError(err);
  }
}

/** Switches the active company. The target must be one the user is an active member of. */
export async function switchCompanyAction(orgId: string): Promise<ActionResult> {
  try {
    const user = await getSessionUser();
    if (!user) throw new UserFacingError("Please sign in first.");
    z.string().uuid().parse(orgId);
    const mine = await listCompanies(user.id);
    if (!mine.some((c) => c.id === orgId))
      throw new UserFacingError("You are not a member of that company.");
    await setActiveOrg(orgId);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1"),
});

/** Updates company profile. Requires org:manage; records old and new values in the audit log. */
export async function updateCompanyProfileAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireActionPermission("org:manage");
    const data = profileSchema.parse(input);

    await withTenant(ctx.organizationId, async (tx) => {
      const [before] = await tx
        .select({
          name: organizations.name,
          legalName: organizations.legalName,
          brandColor: organizations.brandColor,
        })
        .from(organizations)
        .where(and(eq(organizations.id, ctx.organizationId), isNull(organizations.deletedAt)));
      if (!before) throw new UserFacingError("Company not found.");

      await tx
        .update(organizations)
        .set({ name: data.name, legalName: data.legalName ?? null, brandColor: data.brandColor })
        .where(eq(organizations.id, ctx.organizationId));

      await writeAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.user.id,
        actorRole: ctx.role,
        action: "organization.updated",
        entityType: "organization",
        entityId: ctx.organizationId,
        oldValues: before,
        newValues: {
          name: data.name,
          legalName: data.legalName ?? null,
          brandColor: data.brandColor,
        },
      });
    });

    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
