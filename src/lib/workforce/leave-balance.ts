import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { leaveBalances, leaveTypes } from "@/lib/db/schema";
import { carryForward } from "@/lib/leave";

/** Financial-year start (April) for an ISO date. */
export const fyStartOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
};

/** Quota for a joiner part-way through the year, in half-day steps. */
export function prorateQuota(quota: number, joinDate: string, fyStart: number): number {
  if (joinDate <= `${fyStart}-04-01`) return quota;
  const jm = Number(joinDate.slice(5, 7));
  const jy = Number(joinDate.slice(0, 4));
  if (jy > fyStart + 1 || (jy === fyStart + 1 && jm > 3)) return 0;
  const monthsLeft = jy === fyStart ? 12 - (jm - 4) : 4 - jm; // Apr..Mar inclusive of join month
  return Math.round(((quota * monthsLeft) / 12) * 2) / 2;
}

/**
 * Creates the year's balance rows for every leave type that does not have one yet (idempotent).
 * Carry-forward from the previous year is added, limited by each type's maximum.
 */
export async function ensureBalances(
  tx: Tx,
  organizationId: string,
  emp: { id: string; joinDate: string },
  fyStart: number,
) {
  const types = await tx
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.organizationId, organizationId), isNull(leaveTypes.deletedAt)));
  if (types.length === 0) return;
  const existing = await tx
    .select({ t: leaveBalances.leaveTypeId })
    .from(leaveBalances)
    .where(and(eq(leaveBalances.employeeId, emp.id), eq(leaveBalances.fyStart, fyStart)));
  const have = new Set(existing.map((e) => e.t));
  const prev = await tx
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.employeeId, emp.id), eq(leaveBalances.fyStart, fyStart - 1)));
  for (const t of types) {
    if (have.has(t.id)) continue;
    const p = prev.find((x) => x.leaveTypeId === t.id);
    const carried = p
      ? carryForward(Number(p.allotted) - Number(p.used), Number(t.carryForwardMax))
      : 0;
    const allotted = prorateQuota(Number(t.annualQuota), emp.joinDate, fyStart) + carried;
    await tx
      .insert(leaveBalances)
      .values({
        organizationId,
        employeeId: emp.id,
        leaveTypeId: t.id,
        fyStart,
        allotted: String(allotted),
        used: "0",
      })
      .onConflictDoNothing();
  }
}

export const DEFAULT_LEAVE_TYPES = [
  { code: "CL", name: "Casual leave", annualQuota: "12", isPaid: true, carryForwardMax: "0" },
  { code: "SL", name: "Sick leave", annualQuota: "12", isPaid: true, carryForwardMax: "0" },
  { code: "EL", name: "Earned leave", annualQuota: "15", isPaid: true, carryForwardMax: "30" },
  { code: "LOP", name: "Loss of pay", annualQuota: "0", isPaid: false, carryForwardMax: "0" },
];

export async function seedLeaveDefaults(tx: Tx, organizationId: string) {
  const have = await tx
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(eq(leaveTypes.organizationId, organizationId))
    .limit(1);
  if (have.length) return false;
  await tx.insert(leaveTypes).values(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, organizationId })));
  return true;
}
