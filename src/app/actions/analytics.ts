"use server";

import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { designations, salaryBenchmarks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const schema = z.object({
  designationId: z.string().uuid(),
  p25Rupees: z.number().int().min(1),
  p50Rupees: z.number().int().min(1),
  p75Rupees: z.number().int().min(1),
  source: z.string().trim().min(2, "Say where this came from.").max(120),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Market ranges are entered by the company; nothing is bundled or fetched. */
export async function saveBenchmarkAction(input: unknown) {
  const d = schema.parse(input);
  return runAction(
    "salary:write",
    async ({ ctx, tx, audit }) => {
      if (!(d.p25Rupees <= d.p50Rupees && d.p50Rupees <= d.p75Rupees))
        throw new UserFacingError("Ranges must go from low to high (25th, median, 75th).");
      const [des] = await tx
        .select({ id: designations.id })
        .from(designations)
        .where(
          and(
            eq(designations.id, d.designationId),
            eq(designations.organizationId, ctx.organizationId),
          ),
        );
      if (!des) throw new UserFacingError("Designation not found.");
      const v = {
        p25: d.p25Rupees * 100,
        p50: d.p50Rupees * 100,
        p75: d.p75Rupees * 100,
        source: d.source,
        asOf: d.asOf,
      };
      await tx
        .insert(salaryBenchmarks)
        .values({ organizationId: ctx.organizationId, designationId: d.designationId, ...v })
        .onConflictDoUpdate({
          target: [salaryBenchmarks.organizationId, salaryBenchmarks.designationId],
          set: { ...v, updatedAt: new Date() },
        });
      await audit({
        action: "benchmark.saved",
        entityType: "salary_benchmark",
        entityId: d.designationId,
        newValues: v,
      });
      return {};
    },
    ["/analytics"],
  );
}
