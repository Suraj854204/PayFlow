import "server-only";
import { and, eq, inArray, ne, lte, or, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { complianceItems, memberships } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { KIND_LABEL, planCalendar, type ComplianceKind } from "./calendar";
import { addMonths } from "@/lib/payroll/period";

/** Creates the calendar rows for a window around `month` (idempotent: unique per kind and period). */
export async function ensureCalendar(tx: Tx, organizationId: string, month: string) {
  const plan = planCalendar(addMonths(month, -2), 9);
  await tx
    .insert(complianceItems)
    .values(
      plan.map((p) => ({ organizationId, kind: p.kind, period: p.period, dueDate: p.dueDate })),
    )
    .onConflictDoNothing();
}

/**
 * In-app reminders for items due within 7 days or overdue, at most one per item per day, sent to
 * Finance, HR and admins. A scheduled sweep for companies nobody opens arrives with background jobs.
 */
export async function sendComplianceReminders(tx: Tx, organizationId: string, today: string) {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const due = await tx
    .select()
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.organizationId, organizationId),
        eq(complianceItems.status, "pending"),
        lte(complianceItems.dueDate, soon),
        or(isNull(complianceItems.lastRemindedOn), ne(complianceItems.lastRemindedOn, today)),
      ),
    );
  if (due.length === 0) return 0;
  const people = await tx
    .select({ u: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.isActive, true),
        inArray(memberships.role, ["super_admin", "hr_admin", "finance"]),
      ),
    );
  for (const item of due) {
    const overdue = item.dueDate < today;
    for (const p of people)
      await notify(tx, organizationId, {
        userId: p.u,
        type: overdue ? "compliance.overdue" : "compliance.due_soon",
        title: `${KIND_LABEL[item.kind as ComplianceKind] ?? item.kind} for ${item.period} is ${overdue ? "overdue" : "due"} on ${item.dueDate}`,
        href: "/compliance",
      });
    await tx
      .update(complianceItems)
      .set({ lastRemindedOn: today })
      .where(eq(complianceItems.id, item.id));
  }
  return due.length;
}
