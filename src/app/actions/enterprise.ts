"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { featureFlags, fxRates, organizations } from "@/lib/db/schema";
import { isFlagKey } from "@/lib/enterprise/flags";
import { CURRENCIES } from "@/lib/enterprise/fx";
import { parseDomains } from "@/lib/enterprise/sso";

const brandingSchema = z.object({
  brandName: z.string().trim().max(60).optional(),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Logo must be an https:// link.")
    .optional(),
  defaultLocale: z.enum(["en", "hi"]),
});

export async function saveBrandingAction(input: unknown) {
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  const d = parsed.data;
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      await tx
        .update(organizations)
        .set({
          brandName: d.brandName || null,
          logoUrl: d.logoUrl || null,
          defaultLocale: d.defaultLocale,
        })
        .where(eq(organizations.id, ctx.organizationId));
      await audit({
        action: "organization.branding_updated",
        entityType: "organization",
        entityId: ctx.organizationId,
        newValues: {
          brandName: d.brandName || null,
          logoUrl: d.logoUrl || null,
          defaultLocale: d.defaultLocale,
        },
      });
      return {};
    },
    ["/", "/settings/enterprise"],
  );
}

export async function saveSsoDomainsAction(input: unknown) {
  const { domains: raw } = z.object({ domains: z.string().max(500) }).parse(input);
  const { domains, invalid } = parseDomains(raw);
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      if (invalid.length) throw new UserFacingError(`Not a valid domain: ${invalid.join(", ")}`);
      // Lock-out guard: the person making the change must still be able to sign in afterwards.
      // Enforcement only restricts password sign-in, and Google/Microsoft remain available.
      await tx
        .update(organizations)
        .set({ ssoDomains: domains })
        .where(eq(organizations.id, ctx.organizationId));
      await audit({
        action: "organization.sso_domains_updated",
        entityType: "organization",
        entityId: ctx.organizationId,
        newValues: { ssoDomains: domains },
      });
      return { domains };
    },
    ["/settings/enterprise"],
  );
}

export async function setFlagAction(input: unknown) {
  const d = z.object({ key: z.string(), enabled: z.boolean() }).parse(input);
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      if (!isFlagKey(d.key)) throw new UserFacingError("Unknown feature.");
      await tx
        .insert(featureFlags)
        .values({
          organizationId: ctx.organizationId,
          key: d.key,
          enabled: d.enabled,
          updatedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: [featureFlags.organizationId, featureFlags.key],
          set: { enabled: d.enabled, updatedBy: ctx.user.id, updatedAt: new Date() },
        });
      await audit({
        action: "feature_flag.set",
        entityType: "feature_flag",
        entityId: d.key,
        newValues: { enabled: d.enabled },
      });
      return {};
    },
    ["/", "/settings/enterprise"],
  );
}

const fxSchema = z.object({
  currency: z.enum(CURRENCIES),
  /** Rupees per one unit of the foreign currency, as an admin thinks of it (for example 83.2 for USD). */
  inrPerUnit: z.number().positive("Rate must be above zero.").max(100000),
});

export async function saveFxRateAction(input: unknown) {
  const d = fxSchema.parse(input);
  const perInr = (1 / d.inrPerUnit).toFixed(8);
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      await tx
        .insert(fxRates)
        .values({ organizationId: ctx.organizationId, currency: d.currency, perInr })
        .onConflictDoUpdate({
          target: [fxRates.organizationId, fxRates.currency],
          set: { perInr, updatedAt: new Date() },
        });
      await audit({
        action: "fx_rate.saved",
        entityType: "fx_rate",
        entityId: d.currency,
        newValues: { inrPerUnit: d.inrPerUnit },
      });
      return {};
    },
    ["/settings/enterprise", "/simulator"],
  );
}

export async function deleteFxRateAction(input: unknown) {
  const { currency } = z.object({ currency: z.enum(CURRENCIES) }).parse(input);
  return runAction(
    "org:manage",
    async ({ ctx, tx, audit }) => {
      await tx
        .delete(fxRates)
        .where(and(eq(fxRates.organizationId, ctx.organizationId), eq(fxRates.currency, currency)));
      await audit({ action: "fx_rate.deleted", entityType: "fx_rate", entityId: currency });
      return {};
    },
    ["/settings/enterprise", "/simulator"],
  );
}
