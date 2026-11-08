"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { policyDocuments } from "@/lib/db/schema";

export async function deletePolicyAction(id: unknown) {
  return runAction(
    "policies:manage",
    async ({ ctx, tx, audit }) => {
      const pid = z.string().uuid().parse(id);
      const del = await tx
        .delete(policyDocuments)
        .where(
          and(eq(policyDocuments.id, pid), eq(policyDocuments.organizationId, ctx.organizationId)),
        )
        .returning({ title: policyDocuments.title });
      if (del.length === 0) throw new UserFacingError("Policy not found.");
      await audit({
        action: "policy.deleted",
        entityType: "policy_document",
        entityId: pid,
        oldValues: del[0],
      });
      return null;
    },
    ["/policies"],
  );
}
