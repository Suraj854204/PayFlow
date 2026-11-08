"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { complianceItems } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { uuid } from "@/lib/validation/hr";

const schema = z.object({
  itemId: uuid,
  challanNo: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9\-\/]{4,30}$/,
      "Challan or acknowledgement number: 4-30 letters, digits, - or /",
    ),
  amountPaid: z.number().int().min(0).max(1_000_000_000_00),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(200).optional(),
});

/** Records that a statutory payment or return was filed, with its challan number. */
export async function markFiledAction(input: unknown) {
  return runAction(
    "payroll:read",
    async ({ ctx, tx, audit }) => {
      if (!can(ctx.role, "tax:manage") && !can(ctx.role, "payroll:process"))
        throw new UserFacingError("You do not have permission to do that.");
      const d = schema.parse(input);
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      if (d.paidOn > today) throw new UserFacingError("The payment date cannot be in the future.");
      const [item] = await tx
        .select()
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.id, d.itemId),
            eq(complianceItems.organizationId, ctx.organizationId),
          ),
        );
      if (!item) throw new UserFacingError("Item not found.");
      if (item.status === "filed")
        throw new UserFacingError("This item is already marked as filed.");
      await tx
        .update(complianceItems)
        .set({
          status: "filed",
          challanNo: d.challanNo,
          amountPaid: d.amountPaid,
          paidOn: d.paidOn,
          notes: d.notes,
        })
        .where(eq(complianceItems.id, item.id));
      await audit({
        action: "compliance.filed",
        entityType: "compliance_item",
        entityId: item.id,
        oldValues: { status: "pending" },
        newValues: {
          kind: item.kind,
          period: item.period,
          challanNo: d.challanNo,
          amountPaid: d.amountPaid,
          paidOn: d.paidOn,
          late: d.paidOn > item.dueDate,
        },
      });
      return {};
    },
    ["/compliance"],
  );
}
