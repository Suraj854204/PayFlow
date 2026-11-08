"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { computeBreakdown } from "@/lib/salary";
import { assignSalaryTx, assignSchema, toInputs } from "@/lib/workforce/assign-salary";
import { salaryComponents, salaryStructures, type StructureLine } from "@/lib/db/schema";
import { uuid } from "@/lib/validation/hr";

const PATHS = ["/salary", "/employees"];

const componentSchema = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, "2-20 characters: letters, digits, underscore"),
  type: z.enum(["earning", "deduction"]),
  calcType: z.enum(["fixed", "percent_of_ctc", "percent_of_basic", "balancing"]),
  /** fixed: paise per month. percent_*: basis points. */
  value: z.number().int().min(0).max(10_000_000_000),
  isTaxable: z.boolean().default(true),
  isPfWage: z.boolean().default(false),
});

export async function createComponentAction(input: unknown) {
  return runAction(
    "salary:write",
    async ({ ctx, tx, audit }) => {
      const data = componentSchema.parse(input);
      if (data.calcType.startsWith("percent") && data.value > 10_000)
        throw new UserFacingError("A percentage cannot exceed 100%.");
      if (data.calcType === "balancing" && data.type !== "earning")
        throw new UserFacingError("Only an earning can be a balancing figure.");
      const dup = await tx
        .select({ id: salaryComponents.id })
        .from(salaryComponents)
        .where(
          and(
            eq(salaryComponents.organizationId, ctx.organizationId),
            eq(salaryComponents.code, data.code),
            isNull(salaryComponents.deletedAt),
          ),
        );
      if (dup.length)
        throw new UserFacingError(`A component with code ${data.code} already exists.`);
      const [row] = await tx
        .insert(salaryComponents)
        .values({ organizationId: ctx.organizationId, ...data })
        .returning({ id: salaryComponents.id });
      await audit({
        action: "salary_component.created",
        entityType: "salary_component",
        entityId: row.id,
        newValues: data,
      });
      return { id: row.id };
    },
    PATHS,
  );
}

export async function deleteComponentAction(id: unknown) {
  return runAction(
    "salary:write",
    async ({ ctx, tx, audit }) => {
      const cid = uuid.parse(id);
      const [comp] = await tx
        .select()
        .from(salaryComponents)
        .where(
          and(
            eq(salaryComponents.id, cid),
            eq(salaryComponents.organizationId, ctx.organizationId),
            isNull(salaryComponents.deletedAt),
          ),
        );
      if (!comp) throw new UserFacingError("Component not found.");
      if (comp.isSystem) throw new UserFacingError("Built-in components cannot be deleted.");
      const structures = await tx
        .select({ name: salaryStructures.name, lines: salaryStructures.lines })
        .from(salaryStructures)
        .where(
          and(
            eq(salaryStructures.organizationId, ctx.organizationId),
            isNull(salaryStructures.deletedAt),
          ),
        );
      const using = structures.find((s) => s.lines.some((l) => l.componentId === cid));
      if (using)
        throw new UserFacingError(`Used by the template "${using.name}". Remove it there first.`);
      await tx
        .update(salaryComponents)
        .set({ deletedAt: new Date() })
        .where(eq(salaryComponents.id, cid));
      await audit({
        action: "salary_component.deleted",
        entityType: "salary_component",
        entityId: cid,
        oldValues: { code: comp.code, name: comp.name },
      });
    },
    PATHS,
  );
}

const structureSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  componentIds: z.array(z.string().uuid()).min(1).max(40),
});

/** Resolves component rows into a frozen snapshot, so later edits to a component never silently change templates. */
async function buildLines(
  tx: Parameters<Parameters<typeof runAction>[1]>[0]["tx"],
  orgId: string,
  ids: string[],
): Promise<StructureLine[]> {
  const comps = await tx
    .select()
    .from(salaryComponents)
    .where(and(eq(salaryComponents.organizationId, orgId), isNull(salaryComponents.deletedAt)));
  const byId = new Map(comps.map((c) => [c.id, c]));
  return ids.map((id) => {
    const c = byId.get(id);
    if (!c) throw new UserFacingError("One of the selected components no longer exists.");
    return {
      componentId: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      calcType: c.calcType,
      value: c.value,
      isTaxable: c.isTaxable,
      isPfWage: c.isPfWage,
    };
  });
}

export async function saveStructureAction(id: unknown, input: unknown) {
  return runAction(
    "salary:write",
    async ({ ctx, tx, audit }) => {
      const structureId = id ? uuid.parse(id) : null;
      const data = structureSchema.parse(input);
      const lines = await buildLines(tx, ctx.organizationId, data.componentIds);
      // Validate against a sample CTC so a broken template can never be saved.
      const check = computeBreakdown(1_200_000_00, toInputs(lines));
      if (!check.ok) throw new UserFacingError(check.errors[0]);

      if (structureId) {
        const [before] = await tx
          .select({ name: salaryStructures.name })
          .from(salaryStructures)
          .where(
            and(
              eq(salaryStructures.id, structureId),
              eq(salaryStructures.organizationId, ctx.organizationId),
              isNull(salaryStructures.deletedAt),
            ),
          );
        if (!before) throw new UserFacingError("Template not found.");
        await tx
          .update(salaryStructures)
          .set({ name: data.name, description: data.description ?? null, lines })
          .where(eq(salaryStructures.id, structureId));
        await audit({
          action: "salary_structure.updated",
          entityType: "salary_structure",
          entityId: structureId,
          oldValues: before,
          newValues: { name: data.name, components: lines.map((l) => l.code) },
        });
        return { id: structureId };
      }
      const [row] = await tx
        .insert(salaryStructures)
        .values({
          organizationId: ctx.organizationId,
          name: data.name,
          description: data.description ?? null,
          lines,
        })
        .returning({ id: salaryStructures.id });
      await audit({
        action: "salary_structure.created",
        entityType: "salary_structure",
        entityId: row.id,
        newValues: { name: data.name, components: lines.map((l) => l.code) },
      });
      return { id: row.id };
    },
    PATHS,
  );
}

export async function deleteStructureAction(id: unknown) {
  return runAction(
    "salary:write",
    async ({ ctx, tx, audit }) => {
      const sid = uuid.parse(id);
      const [row] = await tx
        .update(salaryStructures)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(salaryStructures.id, sid),
            eq(salaryStructures.organizationId, ctx.organizationId),
            isNull(salaryStructures.deletedAt),
          ),
        )
        .returning({ name: salaryStructures.name });
      if (!row) throw new UserFacingError("Template not found.");
      await audit({
        action: "salary_structure.deleted",
        entityType: "salary_structure",
        entityId: sid,
        oldValues: row,
      });
    },
    PATHS,
  );
}

export async function assignSalaryAction(input: unknown) {
  return runAction("salary:write", (h) => assignSalaryTx(h, assignSchema.parse(input)), [
    ...PATHS,
    `/employees/${String((input as { employeeId?: string })?.employeeId ?? "")}`,
  ]);
}

/** Pure preview used by the builder UI before saving. Needs salary:read, not write. */
export async function previewBreakdownAction(structureId: unknown, ctcAnnual: unknown) {
  return runAction("salary:read", async ({ ctx, tx }) => {
    const sid = uuid.parse(structureId);
    const ctc = z.number().int().positive().parse(ctcAnnual);
    const [structure] = await tx
      .select()
      .from(salaryStructures)
      .where(
        and(
          eq(salaryStructures.id, sid),
          eq(salaryStructures.organizationId, ctx.organizationId),
          isNull(salaryStructures.deletedAt),
        ),
      );
    if (!structure) throw new UserFacingError("Template not found.");
    const r = computeBreakdown(ctc, toInputs(structure.lines));
    if (!r.ok) return { ok: false as const, errors: r.errors };
    return { ok: true as const, breakdown: r.breakdown };
  });
}
