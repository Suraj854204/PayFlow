"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { assertFlagOn } from "@/lib/enterprise/flags-server";
import {
  employees,
  ewaRequests,
  ewaSettings,
  loans,
  memberships,
  payrollRuns,
} from "@/lib/db/schema";
import { decideRequest } from "@/lib/ewa/rules";
import { loadFacts, loadPolicy } from "@/lib/ewa/service";
import { notify } from "@/lib/notify";
import { addMonths } from "@/lib/payroll/period";
import { currentMonthIst } from "@/lib/payroll/run-core";
import type { ActionHelpers } from "@/lib/action-runner";

const PATHS = ["/ewa"];
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Turns an approved request into a one-instalment advance that the normal payroll run recovers. */
async function approveInto(
  { ctx, tx, audit }: ActionHelpers,
  req: typeof ewaRequests.$inferSelect,
  auto: boolean,
) {
  // If this month's payroll already exists, the deduction has to wait for the next one.
  const [run] = await tx
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, ctx.organizationId),
        eq(payrollRuns.month, req.month),
        ne(payrollRuns.status, "cancelled"),
      ),
    );
  const startMonth = run ? addMonths(req.month, 1) : req.month;
  const [loan] = await tx
    .insert(loans)
    .values({
      organizationId: ctx.organizationId,
      employeeId: req.employeeId,
      kind: "advance",
      principal: req.amount,
      emi: req.amount,
      balance: req.amount,
      startMonth,
      reason: "Earned wage access (mock payout)",
      createdBy: ctx.user.id,
    })
    .returning({ id: loans.id });
  await tx
    .update(ewaRequests)
    .set({
      status: "approved",
      autoApproved: auto,
      loanId: loan.id,
      decidedBy: auto ? null : ctx.user.id,
      decidedAt: new Date(),
    })
    .where(eq(ewaRequests.id, req.id));
  await audit({
    action: auto ? "ewa.auto_approved" : "ewa.approved",
    entityType: "ewa_request",
    entityId: req.id,
    newValues: { amount: req.amount, recoveredInMonth: startMonth },
  });
  const [emp] = await tx
    .select({ u: employees.userId })
    .from(employees)
    .where(eq(employees.id, req.employeeId));
  await notify(tx, ctx.organizationId, {
    userId: emp?.u,
    type: "ewa.approved",
    title: `Your advance of ₹${req.amount / 100} was approved`,
    body: `It will be deducted from your ${startMonth} pay. No money has actually moved: this is a demo payout.`,
    href: "/ewa",
  });
  return startMonth;
}

const requestSchema = z.object({ amountRupees: z.number().int().min(1).max(10_000_000) });

export async function requestEwaAction(input: unknown) {
  const d = requestSchema.parse(input);
  return runAction(
    "ewa:request",
    async (h) => {
      const { ctx, tx, audit } = h;
      await assertFlagOn(tx, ctx.organizationId, "ewa");
      if (!ctx.employeeId)
        throw new UserFacingError("Your login is not linked to an employee record.");
      const policy = await loadPolicy(tx, ctx.organizationId);
      if (!policy.enabled)
        throw new UserFacingError("Earned wage access is not turned on for your company.");
      // One request at a time per person, so two tabs cannot both draw the same headroom.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.employeeId}))`);
      const month = currentMonthIst();
      const facts = await loadFacts(tx, ctx.organizationId, ctx.employeeId, month, istToday());
      if (!facts) throw new UserFacingError("Your salary has not been set up yet.");
      const amount = d.amountRupees * 100;
      const decision = decideRequest(amount, facts, policy);
      if (!decision.ok) throw new UserFacingError(decision.error);
      const [req] = await tx
        .insert(ewaRequests)
        .values({
          organizationId: ctx.organizationId,
          employeeId: ctx.employeeId,
          month,
          amount,
          earnedAtRequest: facts.earnedSoFar,
        })
        .returning();
      await audit({
        action: "ewa.requested",
        entityType: "ewa_request",
        entityId: req.id,
        newValues: { amount, month },
      });
      if (decision.outcome === "auto_approved") {
        const m = await approveInto(h, req, true);
        return { status: "approved" as const, recoveredInMonth: m };
      }
      const people = await tx
        .select({ u: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, ctx.organizationId),
            eq(memberships.isActive, true),
            inArray(memberships.role, ["finance", "hr_admin", "super_admin"]),
          ),
        );
      for (const p of people)
        await notify(tx, ctx.organizationId, {
          userId: p.u,
          type: "ewa.requested",
          title: `Advance request of ₹${d.amountRupees} needs approval`,
          href: "/ewa",
        });
      return { status: "pending" as const, recoveredInMonth: null };
    },
    PATHS,
  );
}

const decideSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(200).optional(),
});

export async function decideEwaAction(input: unknown) {
  const d = decideSchema.parse(input);
  return runAction(
    "ewa:manage",
    async (h) => {
      const { ctx, tx, audit } = h;
      await assertFlagOn(tx, ctx.organizationId, "ewa");
      const [req] = await tx
        .select()
        .from(ewaRequests)
        .where(and(eq(ewaRequests.id, d.id), eq(ewaRequests.organizationId, ctx.organizationId)))
        .for("update");
      if (!req) throw new UserFacingError("Request not found.");
      if (req.status !== "pending") throw new UserFacingError("This request was already decided.");
      if (ctx.employeeId && ctx.employeeId === req.employeeId)
        throw new UserFacingError("You cannot decide your own request.");
      if (d.approve) {
        // Re-check against today's facts: pay or attendance may have changed since the request.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${req.employeeId}))`);
        const policy = await loadPolicy(tx, ctx.organizationId);
        const facts = await loadFacts(
          tx,
          ctx.organizationId,
          req.employeeId,
          req.month,
          istToday(),
        );
        if (!facts) throw new UserFacingError("The employee's salary is no longer set up.");
        const check = decideRequest(
          req.amount,
          { ...facts, alreadyDrawn: facts.alreadyDrawn - req.amount, requestsThisMonth: 0 },
          policy,
        );
        if (!check.ok) throw new UserFacingError(`No longer within the limits: ${check.error}`);
        await approveInto(h, req, false);
        return { status: "approved" as const };
      }
      await tx
        .update(ewaRequests)
        .set({
          status: "rejected",
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: d.note ?? null,
        })
        .where(eq(ewaRequests.id, req.id));
      await audit({
        action: "ewa.rejected",
        entityType: "ewa_request",
        entityId: req.id,
        newValues: { note: d.note ?? null },
      });
      const [emp] = await tx
        .select({ u: employees.userId })
        .from(employees)
        .where(eq(employees.id, req.employeeId));
      await notify(tx, ctx.organizationId, {
        userId: emp?.u,
        type: "ewa.rejected",
        title: `Your advance of ₹${req.amount / 100} was declined`,
        body: d.note,
        href: "/ewa",
      });
      return { status: "rejected" as const };
    },
    PATHS,
  );
}

export async function cancelEwaAction(input: unknown) {
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  return runAction(
    "ewa:request",
    async ({ ctx, tx, audit }) => {
      const r = await tx
        .update(ewaRequests)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(ewaRequests.id, id),
            eq(ewaRequests.organizationId, ctx.organizationId),
            eq(ewaRequests.status, "pending"),
            eq(ewaRequests.employeeId, ctx.employeeId ?? "00000000-0000-0000-0000-000000000000"),
          ),
        )
        .returning({ id: ewaRequests.id });
      if (r.length === 0)
        throw new UserFacingError("Only your own pending request can be cancelled.");
      await audit({ action: "ewa.cancelled", entityType: "ewa_request", entityId: id });
      return {};
    },
    PATHS,
  );
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  maxPercent: z.number().int().min(1).max(100),
  monthlyCapRupees: z.number().int().min(500).max(1_000_000),
  autoApproveRupees: z.number().int().min(0).max(1_000_000),
  maxRequestsPerMonth: z.number().int().min(1).max(10),
});

export async function saveEwaSettingsAction(input: unknown) {
  const d = settingsSchema.parse(input);
  return runAction(
    "ewa:manage",
    async ({ ctx, tx, audit }) => {
      if (d.autoApproveRupees > d.monthlyCapRupees)
        throw new UserFacingError("Auto-approval cannot be higher than the monthly cap.");
      const v = {
        enabled: d.enabled,
        maxPercent: d.maxPercent,
        monthlyCap: d.monthlyCapRupees * 100,
        autoApproveLimit: d.autoApproveRupees * 100,
        maxRequestsPerMonth: d.maxRequestsPerMonth,
      };
      await tx
        .insert(ewaSettings)
        .values({ organizationId: ctx.organizationId, ...v })
        .onConflictDoUpdate({
          target: ewaSettings.organizationId,
          set: { ...v, updatedAt: new Date() },
        });
      await audit({ action: "ewa.settings_updated", entityType: "ewa_settings", newValues: v });
      return {};
    },
    PATHS,
  );
}
