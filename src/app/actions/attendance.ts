"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { lockMonthTx } from "@/lib/workforce/lock-month";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import type { AppContext } from "@/lib/auth/context";
import type { Tx } from "@/lib/db";
import {
  attendanceLocks,
  attendanceRecords,
  employees,
  organizations,
  payrollRuns,
  roster,
  shifts,
} from "@/lib/db/schema";
import {
  computeDay,
  dateInTz,
  DEFAULT_SHIFT,
  insideGeofence,
  isValidPoint,
  type ShiftDef,
} from "@/lib/attendance/calc";
import { resolvePunchTime } from "@/lib/attendance/offline";
import { classifyDay, dateRange } from "@/lib/attendance/calendar";
import { MONTH_RE } from "@/lib/payroll/period";
import { loadCalendar } from "@/lib/workforce/calendar";
import { uuid } from "@/lib/validation/hr";

const PATHS = ["/attendance", "/dashboard"];
const pointSchema = z
  .object({ lat: z.number(), lng: z.number() })
  .refine(isValidPoint, "Invalid location")
  .nullable()
  .optional();

function self(ctx: AppContext): string {
  if (!ctx.employeeId)
    throw new UserFacingError("Your login is not linked to an employee record in this company.");
  return ctx.employeeId;
}

async function shiftFor(
  tx: Tx,
  orgId: string,
  employeeId: string,
  date: string,
): Promise<ShiftDef> {
  const [r] = await tx
    .select({ s: shifts.startTime, e: shifts.endTime, g: shifts.graceMinutes })
    .from(roster)
    .innerJoin(shifts, eq(shifts.id, roster.shiftId))
    .where(
      and(
        eq(roster.organizationId, orgId),
        eq(roster.employeeId, employeeId),
        eq(roster.date, date),
      ),
    );
  return r ? { start: r.s, end: r.e, graceMinutes: r.g } : DEFAULT_SHIFT;
}

function checkFence(
  point: { lat: number; lng: number } | null | undefined,
  fence: Parameters<typeof insideGeofence>[1],
) {
  if (!fence) return null;
  if (!point)
    throw new UserFacingError(
      "Location is required to mark attendance. Allow location access and try again.",
    );
  const inside = insideGeofence(point, fence);
  if (!inside)
    throw new UserFacingError(
      `You are outside the office geo-fence (${fence.radiusM} m). Move closer to check in.`,
    );
  return true;
}

export async function checkInAction(input: unknown) {
  return runAction(
    "attendance:read_own",
    async ({ ctx, tx, audit }) => {
      const employeeId = self(ctx);
      const point = pointSchema.parse((input as { point?: unknown } | null)?.point ?? null);
      const pt = resolvePunchTime((input as { at?: unknown } | null)?.at, Date.now());
      if (!pt.ok) throw new UserFacingError(pt.error);
      const now = pt.when;
      const cal = await loadCalendar(tx, ctx.organizationId, "1900-01-01", "1900-01-02");
      const today = dateInTz(now, cal.tz);
      const inFence = checkFence(point, cal.fence);
      const shift = await shiftFor(tx, ctx.organizationId, employeeId, today);
      const day = computeDay(now, null, shift, cal.tz);
      const [existing] = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, today)),
        );
      if (existing?.checkIn) throw new UserFacingError("You have already checked in today.");
      if (existing && existing.status === "leave")
        throw new UserFacingError("You are on approved leave today.");
      const values = {
        organizationId: ctx.organizationId,
        employeeId,
        date: today,
        status: "present" as const,
        checkIn: now,
        inLat: point?.lat ?? null,
        inLng: point?.lng ?? null,
        inGeofence: inFence,
        lateMinutes: day.lateMinutes,
        source: pt.offline ? "offline" : "self",
      };
      if (existing)
        await tx.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, existing.id));
      else await tx.insert(attendanceRecords).values(values);
      await audit({
        action: "attendance.check_in",
        entityType: "attendance",
        entityId: employeeId,
        newValues: { date: today, lateMinutes: day.lateMinutes },
      });
      return { at: now.toISOString(), late: day.lateMinutes };
    },
    PATHS,
  );
}

export async function checkOutAction(input: unknown) {
  return runAction(
    "attendance:read_own",
    async ({ ctx, tx, audit }) => {
      const employeeId = self(ctx);
      const point = pointSchema.parse((input as { point?: unknown } | null)?.point ?? null);
      const pt = resolvePunchTime((input as { at?: unknown } | null)?.at, Date.now());
      if (!pt.ok) throw new UserFacingError(pt.error);
      const now = pt.when;
      const cal = await loadCalendar(tx, ctx.organizationId, "1900-01-01", "1900-01-02");
      checkFence(point, cal.fence);
      // The open record is the latest one without a check-out, so a night shift can check out after midnight.
      const [rec] = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.employeeId, employeeId),
            isNull(attendanceRecords.checkOut),
            sql`${attendanceRecords.checkIn} is not null`,
          ),
        )
        .orderBy(sql`${attendanceRecords.date} desc`)
        .limit(1);
      if (!rec || !rec.checkIn) throw new UserFacingError("You have not checked in.");
      const shift = await shiftFor(tx, ctx.organizationId, employeeId, rec.date);
      const day = computeDay(rec.checkIn, now, shift, cal.tz);
      await tx
        .update(attendanceRecords)
        .set({
          checkOut: now,
          outLat: point?.lat ?? null,
          outLng: point?.lng ?? null,
          workedMinutes: day.workedMinutes,
          overtimeMinutes: day.overtimeMinutes,
          status: day.status,
        })
        .where(eq(attendanceRecords.id, rec.id));
      await audit({
        action: "attendance.check_out",
        entityType: "attendance",
        entityId: employeeId,
        newValues: { date: rec.date, ...day },
      });
      return day;
    },
    PATHS,
  );
}

const manualSchema = z.object({
  employeeId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["present", "half_day", "absent", "leave", "holiday", "weekly_off"]),
  checkIn: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  checkOut: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  note: z.string().trim().min(3, "Give a reason").max(200),
});

/** HR correction of a day. A reason is required and the old record is kept in the audit log. */
export async function manualAttendanceAction(input: unknown) {
  return runAction(
    "attendance:manage",
    async ({ ctx, tx, audit }) => {
      const d = manualSchema.parse(input);
      const [emp] = await tx
        .select({ id: employees.id, join: employees.joinDate })
        .from(employees)
        .where(
          and(eq(employees.id, d.employeeId), eq(employees.organizationId, ctx.organizationId)),
        );
      if (!emp) throw new UserFacingError("Employee not found.");
      if (d.date < emp.join) throw new UserFacingError("That date is before the employee joined.");
      const cal = await loadCalendar(tx, ctx.organizationId, d.date, d.date);
      const at = (hhmm: string) => new Date(`${d.date}T${hhmm}:00+05:30`);
      // Times are entered in company time; only IST is supported for manual times today.
      if ((d.checkIn || d.checkOut) && cal.tz !== "Asia/Kolkata")
        throw new UserFacingError("Manual times are supported for Asia/Kolkata companies only.");
      const checkIn = d.checkIn ? at(d.checkIn) : null;
      const checkOut = d.checkOut ? at(d.checkOut) : null;
      if (checkIn && checkOut && checkOut < checkIn)
        throw new UserFacingError("Check-out is before check-in.");
      let worked = 0;
      let ot = 0;
      let late = 0;
      if (checkIn) {
        const shift = await shiftFor(tx, ctx.organizationId, d.employeeId, d.date);
        const r = computeDay(checkIn, checkOut, shift, cal.tz);
        worked = r.workedMinutes;
        ot = r.overtimeMinutes;
        late = r.lateMinutes;
      }
      const [existing] = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(eq(attendanceRecords.employeeId, d.employeeId), eq(attendanceRecords.date, d.date)),
        );
      const values = {
        organizationId: ctx.organizationId,
        employeeId: d.employeeId,
        date: d.date,
        status: d.status,
        checkIn,
        checkOut,
        workedMinutes: worked,
        overtimeMinutes: ot,
        lateMinutes: late,
        source: "manual",
        note: d.note,
      };
      if (existing)
        await tx.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, existing.id));
      else await tx.insert(attendanceRecords).values(values);
      await audit({
        action: "attendance.corrected",
        entityType: "attendance",
        entityId: d.employeeId,
        oldValues: existing
          ? { date: existing.date, status: existing.status, worked: existing.workedMinutes }
          : null,
        newValues: { date: d.date, status: d.status, worked, note: d.note },
      });
      return {};
    },
    PATHS,
  );
}

const monthSchema = z.object({ month: z.string().regex(MONTH_RE) });

/**
 * Locks a month's attendance for payroll. Every employee who was employed on a working day and has
 * no record for it gets an "absent" record (that is the loss of pay). After this the month's records
 * cannot change, so the payroll run reads a fixed set of figures.
 */
export async function lockMonthAction(input: unknown) {
  return runAction(
    "attendance:manage",
    (h) => lockMonthTx(h, monthSchema.parse(input).month),
    PATHS.concat("/payroll"),
  );
}

export async function unlockMonthAction(input: unknown) {
  return runAction(
    "attendance:manage",
    async ({ ctx, tx, audit }) => {
      const { month } = monthSchema.parse(input);
      const [run] = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.organizationId, ctx.organizationId),
            eq(payrollRuns.month, month),
            sql`${payrollRuns.status} <> 'cancelled'`,
          ),
        );
      if (run)
        throw new UserFacingError(
          "A payroll run exists for this month. Cancel it before unlocking attendance.",
        );
      const del = await tx
        .delete(attendanceLocks)
        .where(
          and(
            eq(attendanceLocks.organizationId, ctx.organizationId),
            eq(attendanceLocks.month, month),
          ),
        )
        .returning({ id: attendanceLocks.id });
      if (!del.length) throw new UserFacingError("This month is not locked.");
      await audit({
        action: "attendance.month_unlocked",
        entityType: "attendance_lock",
        entityId: month,
        oldValues: { month },
      });
      return {};
    },
    PATHS,
  );
}

const shiftSchema = z.object({
  name: z.string().trim().min(1).max(40),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  graceMinutes: z.number().int().min(0).max(120).default(10),
});

export async function createShiftAction(input: unknown) {
  return runAction(
    "attendance:manage",
    async ({ ctx, tx, audit }) => {
      const d = shiftSchema.parse(input);
      if (d.startTime === d.endTime)
        throw new UserFacingError("Start and end time cannot be the same.");
      const [dup] = await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.organizationId, ctx.organizationId),
            eq(shifts.name, d.name),
            isNull(shifts.deletedAt),
          ),
        );
      if (dup) throw new UserFacingError("A shift with this name already exists.");
      const [row] = await tx
        .insert(shifts)
        .values({ organizationId: ctx.organizationId, ...d })
        .returning({ id: shifts.id });
      await audit({ action: "shift.created", entityType: "shift", entityId: row.id, newValues: d });
      return { id: row.id };
    },
    PATHS,
  );
}

const rosterSchema = z.object({
  employeeIds: z.array(uuid).min(1).max(200),
  shiftId: uuid,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Assigns a shift to employees for a date range, replacing any earlier assignment for those days. */
export async function assignRosterAction(input: unknown) {
  return runAction(
    "attendance:manage",
    async ({ ctx, tx, audit }) => {
      const d = rosterSchema.parse(input);
      const dates = dateRange(d.from, d.to);
      if (dates.length === 0) throw new UserFacingError("The end date is before the start date.");
      const [shift] = await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.id, d.shiftId),
            eq(shifts.organizationId, ctx.organizationId),
            isNull(shifts.deletedAt),
          ),
        );
      if (!shift) throw new UserFacingError("Shift not found.");
      const emps = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organizationId, ctx.organizationId),
            inArray(employees.id, d.employeeIds),
          ),
        );
      if (emps.length !== new Set(d.employeeIds).size)
        throw new UserFacingError("Some employees were not found.");
      const cal = await loadCalendar(tx, ctx.organizationId, d.from, d.to);
      const rows = emps.flatMap((e) =>
        dates
          .filter((x) => classifyDay(x, cal.weeklyOffs, cal.holidays) === "working")
          .map((x) => ({
            organizationId: ctx.organizationId,
            employeeId: e.id,
            shiftId: d.shiftId,
            date: x,
          })),
      );
      for (let i = 0; i < rows.length; i += 500)
        await tx
          .insert(roster)
          .values(rows.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [roster.employeeId, roster.date],
            set: { shiftId: d.shiftId },
          });
      await audit({
        action: "roster.assigned",
        entityType: "roster",
        entityId: d.shiftId,
        newValues: { employees: emps.length, from: d.from, to: d.to, days: rows.length },
      });
      return { assigned: rows.length };
    },
    PATHS,
  );
}

const fenceSchema = z.object({
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  radiusM: z.number().int().min(20).max(50_000).nullable(),
  weeklyOffs: z.array(z.number().int().min(0).max(6)).max(3),
});

/** Office location, geo-fence radius and weekly offs. Leave lat/lng/radius empty to switch the fence off. */
export async function saveWorkplaceAction(input: unknown) {
  return runAction(
    "attendance:manage",
    async ({ ctx, tx, audit }) => {
      const d = fenceSchema.parse(input);
      const set = [d.lat, d.lng, d.radiusM].filter((x) => x !== null).length;
      if (set !== 0 && set !== 3)
        throw new UserFacingError(
          "Give latitude, longitude and radius together, or leave all three empty.",
        );
      const [old] = await tx
        .select({
          lat: organizations.geofenceLat,
          lng: organizations.geofenceLng,
          r: organizations.geofenceRadiusM,
          w: organizations.weeklyOffs,
        })
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId));
      await tx
        .update(organizations)
        .set({
          geofenceLat: d.lat,
          geofenceLng: d.lng,
          geofenceRadiusM: d.radiusM,
          weeklyOffs: [...new Set(d.weeklyOffs)].sort(),
        })
        .where(eq(organizations.id, ctx.organizationId));
      await audit({
        action: "workplace.updated",
        entityType: "organization",
        entityId: ctx.organizationId,
        oldValues: old,
        newValues: d,
      });
      return {};
    },
    PATHS,
  );
}
