import "server-only";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { UserFacingError } from "@/lib/action";
import type { Tx } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import { resolveFlags, type FlagKey } from "./flags";

export async function loadFlags(tx: Tx, organizationId: string) {
  const rows = await tx
    .select({ key: featureFlags.key, enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(eq(featureFlags.organizationId, organizationId));
  return resolveFlags(rows);
}

/** Pages call this so a switched-off feature is genuinely unreachable, not just hidden. */
export async function requireFlagOn(tx: Tx, organizationId: string, key: FlagKey) {
  if (!(await loadFlags(tx, organizationId))[key]) notFound();
}

/** Server actions call this so a switched-off feature rejects requests even if someone has the page open. */
export async function assertFlagOn(tx: Tx, organizationId: string, key: FlagKey) {
  if (!(await loadFlags(tx, organizationId))[key])
    throw new UserFacingError("This feature is turned off for your company.");
}
