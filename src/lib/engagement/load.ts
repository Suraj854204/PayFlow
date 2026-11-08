import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { attendanceRecords, employees, recognitions } from "@/lib/db/schema";
import { classifyDay } from "@/lib/attendance/calendar";
import { addMonths, monthEnd, monthStart } from "@/lib/payroll/period";
import { loadCalendar } from "@/lib/workforce/calendar";
import { computeBadges, type Badge } from "./badges";
import { currentStreak } from "./streak";

const daysAgo = (today: string, n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

export interface MyEngagement {
  streak: { days: number; best: number };
  badges: Badge[];
  given: number;
  received: number;
}

/** Streak and badges for one person, computed from their verified attendance and recognitions. */
export async function loadMyEngagement(
  tx: Tx,
  orgId: string,
  employeeId: string,
  today: string,
): Promise<MyEngagement> {
  const [emp] = await tx
    .select({ join: employees.joinDate })
    .from(employees)
    .where(eq(employees.id, employeeId));
  const from = addMonths(today.slice(0, 7), -6);
  const rows = await tx
    .select({
      date: attendanceRecords.date,
      status: attendanceRecords.status,
      late: attendanceRecords.lateMinutes,
      checkIn: attendanceRecords.checkIn,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, employeeId),
        gte(attendanceRecords.date, monthStart(from)),
      ),
    );
  const cal = await loadCalendar(tx, orgId, monthStart(from), today);
  const isOff = (d: string) => classifyDay(d, cal.weeklyOffs, cal.holidays) !== "working";
  const streak = currentStreak(
    rows.map((r) => ({ date: r.date, status: r.status })),
    today,
    isOff,
  );

  const completedMonths = Array.from({ length: 5 }, (_, i) =>
    addMonths(today.slice(0, 7), -(i + 1)),
  )
    .filter((m) => m >= (emp?.join ?? "0000").slice(0, 7) && monthEnd(m) < today)
    .map((m) => {
      const inM = rows.filter((r) => r.date.startsWith(m));
      return {
        month: m,
        absences: inM.filter((r) => r.status === "absent" || r.status === "half_day").length,
        lateDays: inM.filter((r) => r.late > 0).length,
        workingDays: inM.filter(
          (r) => r.status === "present" || r.status === "absent" || r.status === "half_day",
        ).length,
      };
    });
  const since30 = daysAgo(today, 30);
  const onTime = rows.filter(
    (r) => r.date >= since30 && r.status === "present" && r.checkIn && r.late === 0,
  ).length;

  const [g] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recognitions)
    .where(eq(recognitions.fromEmployeeId, employeeId));
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recognitions)
    .where(eq(recognitions.toEmployeeId, employeeId));
  const badges = computeBadges({
    streakDays: streak.days,
    bestStreak: streak.best,
    completedMonths,
    onTimeCheckInsLast30: onTime,
    recognitionsGiven: g?.n ?? 0,
    recognitionsReceived: r?.n ?? 0,
    tenureMonths: emp ? monthsBetween(emp.join, today) : 0,
  });
  return { streak, badges, given: g?.n ?? 0, received: r?.n ?? 0 };
}

export async function recentRecognitions(tx: Tx, orgId: string, limit = 15) {
  return tx
    .select({
      id: recognitions.id,
      value: recognitions.value,
      message: recognitions.message,
      at: recognitions.createdAt,
      fromId: recognitions.fromEmployeeId,
      toId: recognitions.toEmployeeId,
    })
    .from(recognitions)
    .where(eq(recognitions.organizationId, orgId))
    .orderBy(desc(recognitions.createdAt))
    .limit(limit);
}
