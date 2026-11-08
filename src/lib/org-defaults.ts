import "server-only";
import { count, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { salaryComponents, salaryStructures, type StructureLine } from "@/lib/db/schema";
import { DEFAULT_COMPONENTS } from "@/lib/salary";

/** Gives a company the standard Basic / HRA / Special allowance components and a starter template. */
export async function seedSalaryDefaults(tx: Tx, organizationId: string) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(salaryComponents)
    .where(eq(salaryComponents.organizationId, organizationId));
  if (n > 0) return;

  const inserted = await tx
    .insert(salaryComponents)
    .values(
      DEFAULT_COMPONENTS.map((c) => ({
        organizationId,
        name: c.name,
        code: c.code,
        type: c.type,
        calcType: c.calcType,
        value: c.value,
        isTaxable: c.isTaxable,
        isPfWage: c.isPfWage,
        isSystem: true,
        position: c.position,
      })),
    )
    .returning();

  const lines: StructureLine[] = inserted
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      componentId: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      calcType: c.calcType,
      value: c.value,
      isTaxable: c.isTaxable,
      isPfWage: c.isPfWage,
    }));

  await tx.insert(salaryStructures).values({
    organizationId,
    name: "Standard (50% basic, 40% HRA)",
    description: "Basic is 50% of CTC, HRA is 40% of Basic, the rest is Special Allowance.",
    lines,
  });
}
