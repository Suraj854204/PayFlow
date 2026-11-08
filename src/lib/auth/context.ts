import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";
import { assertCan, can, isRole, type Permission, type Role } from "@/lib/rbac";

export const ACTIVE_ORG_COOKIE = "pf_org";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  twoFactorEnabled: boolean;
}

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  brandColor: string;
  brandName: string | null;
  logoUrl: string | null;
  defaultLocale: string;
}

export interface AppContext {
  user: AppUser;
  organizationId: string;
  role: Role;
  membershipId: string;
  employeeId: string | null;
  companies: CompanySummary[];
}

export const getSessionUser = cache(async (): Promise<AppUser | null> => {
  // Skip the signed cookie cache: a revoked session (password reset, sign out everywhere) must stop
  // working at once, not up to five minutes later. One session lookup per request, de-duplicated.
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  if (!session) return null;
  const u = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
  };
});

export const listCompanies = cache(async (userId: string) => {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        membershipId: memberships.id,
        employeeId: memberships.employeeId,
        role: memberships.role,
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        brandColor: organizations.brandColor,
        brandName: organizations.brandName,
        logoUrl: organizations.logoUrl,
        defaultLocale: organizations.defaultLocale,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.isActive, true),
          isNull(memberships.deletedAt),
          isNull(organizations.deletedAt),
        ),
      ),
  );
  return rows;
});

/**
 * Resolves the signed-in user, their active company and their role in it. The active company comes
 * from a cookie but is ALWAYS re-validated against the user's memberships, so a forged cookie can
 * never grant access to another tenant.
 */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const rows = await listCompanies(user.id);
  if (rows.length === 0) return null;

  const wanted = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = rows.find((r) => r.id === wanted) ?? rows[0];
  if (!isRole(active.role)) return null;

  return {
    user,
    organizationId: active.id,
    role: active.role,
    membershipId: active.membershipId,
    employeeId: active.employeeId,
    companies: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      role: r.role as Role,
      brandColor: r.brandColor,
      brandName: r.brandName,
      logoUrl: r.logoUrl,
      defaultLocale: r.defaultLocale,
    })),
  };
});

/** For pages/layouts: redirects to login or company creation as needed. */
export async function requireContext(): Promise<AppContext> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/** For pages: requires context AND a permission; sends unauthorised users back to the dashboard. */
export async function requirePagePermission(permission: Permission): Promise<AppContext> {
  const ctx = await requireContext();
  if (!can(ctx.role, permission)) redirect("/dashboard?denied=1");
  return ctx;
}

/** For server actions / route handlers: throws if unauthenticated or lacking the permission. */
export async function requireActionPermission(permission: Permission): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new UnauthorizedError();
  assertCan(ctx.role, permission);
  return ctx;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** For the sign-in and sign-up pages: send people who are really signed in to the app. */
export async function redirectIfSignedIn(to = "/dashboard") {
  if (await getSessionUser()) redirect(to);
}
