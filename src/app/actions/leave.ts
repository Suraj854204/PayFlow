"use server";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { runAction, type ActionHelpers } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import {
  attendanceLocks,
  attendanceRecords,
  employees,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  memberships,
} from "@/lib/db/schema";
import { classifyDay, dateRange } from "@/lib/attendance/calendar";
import { checkBalance, chargeableDays, overlaps } from "@/lib/leave";
import { notify } from "@/lib/notify";
import { emitEvent } from "@/lib/workflow/dispatch";
import { can } from "@/lib/rbac";
import { ensureBalances, fyStartOf, seedLeaveDefaults } from "@/lib/workforce/leave-balance";
import { loadCalendar } from "@/lib/workforce/calendar";
import { uuid } from "@/lib/validation/hr";

const PATHS = ["/leave", "/dashboard", "/attendance"];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const typeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,8}$/, "2-8 letters"),
  name: z.string().trim().min(2).max(40),
  annualQuota: z.number().min(0).max(365).multipleOf(0.5),
  isPaid: z.boolean(),
  carryForwardMax: z.number().min(0).max(365).multipleOf(0.5).default(0),
});

export async function createLeaveTypeAction(input: unknown) {
  return runAction(
    "leave:manage",
    async ({ ctx, tx, audit }) => {
      const d = typeSchema.parse(input);
      const [dup] = await tx
        .select({ id: leaveTypes.id })
        .from(leaveTypes)
        .where(
          and(
            eq(leaveTypes.organizationId, ctx.organizationId),
            eq(leaveTypes.code, d.code),
            sql`${leaveTypes.deletedAt} is null`,
          ),
        );
      if (dup) throw new UserFacingError(`A leave type with code ${d.code} already exists.`);
      const [row] = await tx
        .insert(leaveTypes)
        .values({
          organizationId: ctx.organizationId,
          code: d.code,
          name: d.name,
          annualQuota: String(d.annualQuota),
          isPaid: d.isPaid,
          carryForwardMax: String(d.carryForwardMax),
        })
        .returning({ id: leaveTypes.id });
      await audit({
        action: "leave_type.created",
        entityType: "leave_type",
        entityId: row.id,
        newValues: d,
      });
      return { id: row.id };
    },
    PATHS,
  );
}

export async function seedLeaveTypesAction() {
  return runAction(
    "leave:manage",
    async ({ ctx, tx, audit }) => {
      const added = await seedLeaveDefaults(tx, ctx.organizationId);
      if (!added) throw new UserFacingError("Leave types already exist.");
      await audit({ action: "leave_type.defaults_added", entityType: "leave_type" });
      return {};
    },
    PATHS,
  );
}

const applySchema = z.object({
  leaveTypeId: uuid,
  fromDate: isoDate,
  toDate: isoDate,
  halfDay: z.boolean().default(false),
  reason: z.string().trim().max(300).optional(),
});

async function pendingDays(
  tx: ActionHelpers["tx"],
  employeeId: string,
  leaveTypeId: string,
  fy: number,
) {
  const rows = await tx
    .select({ d: leaveRequests.days })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.leaveTypeId, leaveTypeId),
        eq(leaveRequests.status, "pending"),
        gte(leaveRequests.fromDate, `${fy}-04-01`),
        lte(leaveRequests.fromDate, `${fy + 1}-03-31`),
      ),
    );
  return rows.reduce((s, r) => s + Number(r.d), 0);
}

export async function applyLeaveAction(input: unknown) {
  let event: { orgId: string; payload: Record<string, unknown> } | null = null;
  const res = await runAction(
    "leave:apply",
    async ({ ctx, tx, audit }) => {
      const d = applySchema.parse(input);
      if (!ctx.employeeId)
        throw new UserFacingError(
          "Your login is not linked to an employee record in this company.",
        );
      if (d.toDate < d.fromDate)
        throw new UserFacingError("The end date is before the start date.");
      if (d.halfDay && d.fromDate !== d.toDate)
        throw new UserFacingError("A half day must be a single date.");
      const fy = fyStartOf(d.fromDate);
      if (fyStartOf(d.toDate) !== fy)
        throw new UserFacingError("Split requests that cross 31 March into two requests.");

      const [emp] = await tx.select().from(employees).where(eq(employees.id, ctx.employeeId));
      if (!emp) throw new UserFacingError("Employee not found.");
      if (d.fromDate < emp.joinDate)
        throw new UserFacingError("Leave cannot start before your joining date.");
      const [type] = await tx
        .select()
        .from(leaveTypes)
        .where(
          and(
            eq(leaveTypes.id, d.leaveTypeId),
            eq(leaveTypes.organizationId, ctx.organizationId),
            sql`${leaveTypes.deletedAt} is null`,
          ),
        );
      if (!type) throw new UserFacingError("Leave type not found.");

      const cal = await loadCalendar(tx, ctx.organizationId, d.fromDate, d.toDate);
      const days = chargeableDays(d.fromDate, d.toDate, cal, d.halfDay);

      const mine = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.employeeId, emp.id),
            inArray(leaveRequests.status, ["pending", "approved"]),
            lte(leaveRequests.fromDate, d.toDate),
            gte(leaveRequests.toDate, d.fromDate),
          ),
        );
      if (mine.some((r) => overlaps(r.fromDate, r.toDate, d.fromDate, d.toDate)))
        throw new UserFacingError("You already have a pending or approved leave on these dates.");

      if (type.isPaid) {
        await ensureBalances(tx, ctx.organizationId, emp, fy);
        const [bal] = await tx
          .select()
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.employeeId, emp.id),
              eq(leaveBalances.leaveTypeId, type.id),
              eq(leaveBalances.fyStart, fy),
            ),
          );
        const check = checkBalance(
          Number(bal?.allotted ?? 0),
          Number(bal?.used ?? 0) + (await pendingDays(tx, emp.id, type.id, fy)),
          days,
        );
        if (!check.ok) throw new UserFacingError(check.error);
      } else if (days <= 0) {
        throw new UserFacingError("This request falls entirely on weekly offs or holidays.");
      }

      const [row] = await tx
        .insert(leaveRequests)
        .values({
          organizationId: ctx.organizationId,
          employeeId: emp.id,
          leaveTypeId: type.id,
          fromDate: d.fromDate,
          toDate: d.toDate,
          days: String(days),
          halfDay: d.halfDay,
          reason: d.reason,
        })
        .returning({ id: leaveRequests.id });

      // Tell the manager, or HR if there is no manager with a login.
      let approvers: (string | null)[] = [];
      if (emp.managerId) {
        const [m] = await tx
          .select({ u: employees.userId })
          .from(employees)
          .where(eq(employees.id, emp.managerId));
        approvers = [m?.u ?? null];
      }
      if (!approvers[0]) {
        const hr = await tx
          .select({ u: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, ctx.organizationId),
              inArray(memberships.role, ["hr_admin", "super_admin"]),
              eq(memberships.isActive, true),
            ),
          );
        approvers = hr.map((h) => h.u);
      }
      for (const u of approvers)
        await notify(tx, ctx.organizationId, {
          userId: u,
          type: "leave.requested",
          title: `${emp.firstName} requested ${days} day(s) of ${type.name}`,
          href: "/leave",
        });
      await audit({
        action: "leave.requested",
        entityType: "leave_request",
        entityId: row.id,
        newValues: { type: type.code, from: d.fromDate, to: d.toDate, days },
      });
      event = {
        orgId: ctx.organizationId,
        payload: {
          employee: {
            id: emp.id,
            userId: emp.userId,
            name: `${emp.firstName} ${emp.lastName}`.trim(),
            email: emp.email,
          },
          leave: {
            id: row.id,
            type: type.name,
            from: d.fromDate,
            to: d.toDate,
            days,
            reason: d.reason ?? "",
          },
        },
      };
      return { id: row.id, days };
    },
    PATHS,
  );
  // Only after the request is committed, so an automation never reacts to a rolled-back change.
  const e = event as { orgId: string; payload: Record<string, unknown> } | null;
  if (res.ok && e) await emitEvent(e.orgId, "leave.applied", e.payload).catch(console.error);
  return res;
}

const decideSchema = z.object({
  requestId: uuid,
  approve: z.boolean(),
  note: z.string().trim().max(200).optional(),
});

export async function decideLeaveAction(input: unknown) {
  return runAction(
    "leave:approve",
    async ({ ctx, tx, audit }) => {
      const d = decideSchema.parse(input);
      await tx.execute(sql`select id from leave_requests where id = ${d.requestId} for update`);
      const [req] = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.id, d.requestId),
            eq(leaveRequests.organizationId, ctx.organizationId),
          ),
        );
      if (!req) throw new UserFacingError("Request not found.");
      if (req.status !== "pending")
        throw new UserFacingError("This request has already been decided.");
      if (req.employeeId === ctx.employeeId)
        throw new UserFacingError(
          "You cannot decide your own leave. Someone else must approve it.",
        );
      const [emp] = await tx.select().from(employees).where(eq(employees.id, req.employeeId));
      const isHr = can(ctx.role, "leave:manage");
      if (!isHr && !(emp.managerId && emp.managerId === ctx.employeeId))
        throw new UserFacingError("You can only decide leave for people who report to you.");

      if (d.approve) {
        const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));
        const fy = fyStartOf(req.fromDate);
        if (type.isPaid) {
          await ensureBalances(tx, ctx.organizationId, emp, fy);
          const [bal] = await tx
            .select()
            .from(leaveBalances)
            .where(
              and(
                eq(leaveBalances.employeeId, emp.id),
                eq(leaveBalances.leaveTypeId, type.id),
                eq(leaveBalances.fyStart, fy),
              ),
            );
          const check = checkBalance(
            Number(bal?.allotted ?? 0),
            Number(bal?.used ?? 0),
            Number(req.days),
          );
          if (!check.ok) throw new UserFacingError(check.error);
          await tx
            .update(leaveBalances)
            .set({ used: sql`${leaveBalances.used} + ${req.days}` })
            .where(eq(leaveBalances.id, bal.id));
        }
        // Full days become attendance "leave" records so they are not counted as absent.
        if (!req.halfDay) {
          const cal = await loadCalendar(tx, ctx.organizationId, req.fromDate, req.toDate);
          const dates = dateRange(req.fromDate, req.toDate).filter(
            (x) => classifyDay(x, cal.weeklyOffs, cal.holidays) === "working",
          );
          const months = [...new Set(dates.map((x) => x.slice(0, 7)))];
          if (months.length) {
            const locked = await tx
              .select({ m: attendanceLocks.month })
              .from(attendanceLocks)
              .where(
                and(
                  eq(attendanceLocks.organizationId, ctx.organizationId),
                  inArray(attendanceLocks.month, months),
                ),
              );
            if (locked.length)
              throw new UserFacingError(
                `Attendance for ${locked[0].m} is locked for payroll. Unlock it first, or record this leave manually.`,
              );
          }
          for (const x of dates)
            await tx
              .insert(attendanceRecords)
              .values({
                organizationId: ctx.organizationId,
                employeeId: emp.id,
                date: x,
                status: "leave",
                source: "leave",
                note: type.name,
              })
              .onConflictDoUpdate({
                target: [attendanceRecords.employeeId, attendanceRecords.date],
                set: { status: "leave", source: "leave", note: type.name },
              });
        }
      }
      await tx
        .update(leaveRequests)
        .set({
          status: d.approve ? "approved" : "rejected",
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: d.note,
        })
        .where(eq(leaveRequests.id, req.id));
      await notify(tx, ctx.organizationId, {
        userId: emp.userId,
        type: "leave.decided",
        title: `Your leave was ${d.approve ? "approved" : "rejected"}`,
        body: d.note,
        href: "/leave",
      });
      await audit({
        action: d.approve ? "leave.approved" : "leave.rejected",
        entityType: "leave_request",
        entityId: req.id,
        oldValues: { status: "pending" },
        newValues: { status: d.approve ? "approved" : "rejected", note: d.note },
      });
      return {};
    },
    PATHS,
  );
}

export async function cancelLeaveAction(input: unknown) {
  return runAction(
    "leave:apply",
    async ({ ctx, tx, audit }) => {
      const { requestId } = z.object({ requestId: uuid }).parse(input);
      await tx.execute(sql`select id from leave_requests where id = ${requestId} for update`);
      const [req] = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.id, requestId),
            eq(leaveRequests.organizationId, ctx.organizationId),
          ),
        );
      if (!req || req.employeeId !== ctx.employeeId)
        throw new UserFacingError("Request not found.");
      if (req.status === "pending") {
        await tx
          .update(leaveRequests)
          .set({ status: "cancelled" })
          .where(eq(leaveRequests.id, req.id));
      } else if (req.status === "approved") {
        const cal = await loadCalendar(tx, ctx.organizationId, "1900-01-01", "1900-01-02");
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: cal.tz }).format(new Date());
        if (req.fromDate <= today)
          throw new UserFacingError(
            "Leave that has already started cannot be cancelled. Ask HR to correct it.",
          );
        const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));
        if (type.isPaid)
          await tx
            .update(leaveBalances)
            .set({ used: sql`${leaveBalances.used} - ${req.days}` })
            .where(
              and(
                eq(leaveBalances.employeeId, req.employeeId),
                eq(leaveBalances.leaveTypeId, type.id),
                eq(leaveBalances.fyStart, fyStartOf(req.fromDate)),
              ),
            );
        await tx
          .delete(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.employeeId, req.employeeId),
              eq(attendanceRecords.source, "leave"),
              eq(attendanceRecords.status, "leave"),
              gte(attendanceRecords.date, req.fromDate),
              lte(attendanceRecords.date, req.toDate),
            ),
          );
        await tx
          .update(leaveRequests)
          .set({ status: "cancelled" })
          .where(eq(leaveRequests.id, req.id));
      } else {
        throw new UserFacingError("This request can no longer be cancelled.");
      }
      await audit({
        action: "leave.cancelled",
        entityType: "leave_request",
        entityId: req.id,
        oldValues: { status: req.status },
        newValues: { status: "cancelled" },
      });
      return {};
    },
    PATHS,
  );
}
