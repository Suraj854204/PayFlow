import "server-only";
import { revalidatePath } from "next/cache";
import { withTenant, type Tx } from "@/lib/db";
import { requireActionPermission, type AppContext } from "@/lib/auth/context";
import { writeAudit, type AuditInput } from "@/lib/audit";
import { toActionError, type ActionResult } from "@/lib/action";
import type { Permission } from "@/lib/rbac";

export interface ActionHelpers {
  ctx: AppContext;
  tx: Tx;
  /** Writes an audit entry in the same transaction as the change. */
  audit: (entry: Omit<AuditInput, "organizationId" | "actorUserId" | "actorRole">) => Promise<void>;
}

/**
 * Standard server-action pipeline: authenticate, check the permission on the server, open a
 * tenant-scoped transaction (row-level security), run the work, map errors to safe results, and
 * revalidate the affected paths. Validate input with Zod inside `fn`.
 */
export async function runAction<T>(
  permission: Permission,
  fn: (h: ActionHelpers) => Promise<T>,
  revalidate: string[] = [],
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireActionPermission(permission);
    const data = await withTenant(ctx.organizationId, (tx) =>
      fn({
        ctx,
        tx,
        audit: async (entry) => {
          await writeAudit(tx, {
            ...entry,
            organizationId: ctx.organizationId,
            actorUserId: ctx.user.id,
            actorRole: ctx.role,
          });
        },
      }),
    );
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err);
  }
}
