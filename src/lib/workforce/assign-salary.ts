import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import type { ActionHelpers } from "@/lib/action-runner";
import { employeeSalaries, employees, salaryStructures, type StructureLine } from "@/lib/db/schema";
import { computeBreakdown, type SalaryLineInput } from "@/lib/salary";

export function toInputs(lines: StructureLine[]): SalaryLineInput[] {
  return lines.map(({ componentId: _c, ...l }) => {
    void _c;
    return l;
  });
}

export const assignSchema = z.object({
  employeeId: z.string().uuid(),
  structureId: z.string().uuid(),
  /** Annual CTC in paise. */
  ctcAnnual: z.number().int().positive().max(100_000_000_000_00),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(200).optional(),
});
export type AssignInput = z.infer<typeof assignSchema>;

/**
 * Assigns or revises an employee's salary inside the caller's transaction. History is append-only:
 * a revision adds a new row with its own effective date, and the previous row is never edited.
 */
export async function assignSalaryTx({ ctx, tx, audit }: ActionHelpers, data: AssignInput) {
  const [emp] = await tx
    .select({ id: employees.id, joinDate: employees.joinDate })
    .from(employees)
    .where(
      and(
        eq(employees.id, data.employeeId),
        eq(employees.organizationId, ctx.organizationId),
        isNull(employees.deletedAt),
      ),
    );
  if (!emp) throw new UserFacingError("Employee not found.");
  if (data.effectiveFrom < emp.joinDate)
    throw new UserFacingError("Effective date cannot be before the join date.");

  const [structure] = await tx
    .select()
    .from(salaryStructures)
    .where(
      and(
        eq(salaryStructures.id, data.structureId),
        eq(salaryStructures.organizationId, ctx.organizationId),
        isNull(salaryStructures.deletedAt),
      ),
    );
  if (!structure) throw new UserFacingError("Template not found.");

  const result = computeBreakdown(data.ctcAnnual, toInputs(structure.lines));
  if (!result.ok) throw new UserFacingError(result.errors[0]);

  const [prev] = await tx
    .select({
      ctcAnnual: employeeSalaries.ctcAnnual,
      effectiveFrom: employeeSalaries.effectiveFrom,
    })
    .from(employeeSalaries)
    .where(
      and(
        eq(employeeSalaries.employeeId, data.employeeId),
        eq(employeeSalaries.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(employeeSalaries.effectiveFrom))
    .limit(1);
  if (prev && data.effectiveFrom <= prev.effectiveFrom) {
    throw new UserFacingError(
      `A revision must take effect after the latest one (${prev.effectiveFrom}).`,
    );
  }

  const [row] = await tx
    .insert(employeeSalaries)
    .values({
      organizationId: ctx.organizationId,
      employeeId: data.employeeId,
      structureId: data.structureId,
      ctcAnnual: data.ctcAnnual,
      effectiveFrom: data.effectiveFrom,
      breakdown: result.breakdown.lines,
      reason: data.reason ?? (prev ? "Revision" : "Initial salary"),
      createdBy: ctx.user.id,
    })
    .returning({ id: employeeSalaries.id });
  await audit({
    action: prev ? "salary.revised" : "salary.assigned",
    entityType: "employee",
    entityId: data.employeeId,
    oldValues: prev ? { ctcAnnual: prev.ctcAnnual, effectiveFrom: prev.effectiveFrom } : null,
    newValues: {
      ctcAnnual: data.ctcAnnual,
      effectiveFrom: data.effectiveFrom,
      structure: structure.name,
    },
  });
  return { id: row.id };
}
