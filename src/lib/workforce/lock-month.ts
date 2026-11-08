import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { UserFacingError } from "@/lib/action";
import type { ActionHelpers } from "@/lib/action-runner";
import { attendanceLocks, attendanceRecords, employees } from "@/lib/db/schema";
import { classifyDay, monthDates } from "@/lib/attendance/calendar";
import { dateInTz } from "@/lib/attendance/calc";
import { loadCalendar } from "./calendar";

/** Locks a month's attendance for payroll inside the caller's transaction; missing working days become absences. */
export async function lockMonthTx({ ctx, tx, audit }: ActionHelpers, month: string) {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  if (month > today) throw new UserFacingError("You cannot lock a future month.");
  const dates = monthDates(month);
  const cal = await loadCalendar(tx, ctx.organizationId, dates[0], dates[dates.length - 1]);
  const [already] = await tx
    .select({ id: attendanceLocks.id })
    .from(attendanceLocks)
    .where(
      and(eq(attendanceLocks.organizationId, ctx.organizationId), eq(attendanceLocks.month, month)),
    );
  if (already) throw new UserFacingError("This month is already locked.");
  // For the current month only days up to today can be absent.
  const lastDay = month === today ? dateInTz(new Date(), cal.tz) : dates[dates.length - 1];

  const emps = await tx
    .select({ id: employees.id, join: employees.joinDate, exit: employees.exitDate })
    .from(employees)
    .where(and(eq(employees.organizationId, ctx.organizationId), isNull(employees.deletedAt)));
  const recs = await tx
    .select({ e: attendanceRecords.employeeId, d: attendanceRecords.date })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.organizationId, ctx.organizationId),
        gte(attendanceRecords.date, dates[0]),
        lte(attendanceRecords.date, dates[dates.length - 1]),
      ),
    );
  const have = new Set(recs.map((r) => `${r.e}|${r.d}`));
  const missing: (typeof attendanceRecords.$inferInsert)[] = [];
  for (const e of emps) {
    for (const d of dates) {
      if (d > lastDay || d < e.join || (e.exit && d > e.exit)) continue;
      if (classifyDay(d, cal.weeklyOffs, cal.holidays) !== "working") continue;
      if (have.has(`${e.id}|${d}`)) continue;
      missing.push({
        organizationId: ctx.organizationId,
        employeeId: e.id,
        date: d,
        status: "absent",
        source: "system",
        note: "No attendance or leave recorded at month close",
      });
    }
  }
  for (let i = 0; i < missing.length; i += 500)
    await tx.insert(attendanceRecords).values(missing.slice(i, i + 500));
  await tx
    .insert(attendanceLocks)
    .values({ organizationId: ctx.organizationId, month, lockedBy: ctx.user.id });
  await audit({
    action: "attendance.month_locked",
    entityType: "attendance_lock",
    entityId: month,
    newValues: { month, absentMarked: missing.length },
  });
  return { absentMarked: missing.length };
}
