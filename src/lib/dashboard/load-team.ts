import "server-only";
import { and, count, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  attendanceRecords,
  employees,
  employeeSalaries,
  expenseClaims,
  leaveRequests,
} from "@/lib/db/schema";
import { loadCalendar } from "@/lib/workforce/calendar";
import { classifyDay } from "@/lib/attendance/calendar";

export type TeamStatus = "present" | "late" | "on_leave" | "absent" | "not_in" | "off";
export interface TeamMember {
  id: string;
  name: string;
  status: TeamStatus;
}
export interface Signal {
  employeeId: string;
  name: string;
  lateDays: number;
  absentDays: number;
}
export interface TeamDashboard {
  members: TeamMember[];
  counts: Record<TeamStatus, number>;
  pending: { leave: number; expenses: number };
  /** Total monthly CTC of the team, or null when the viewer may not see cost. */
  monthlyCost: number | null;
  signals: Signal[];
}

/**
 * The manager view of their direct reports: today's attendance, queues, team cost, and
 * attendance patterns worth a conversation. Returns null when the person manages nobody.
 */
export async function loadTeamDashboard(
  tx: Tx,
  organizationId: string,
  managerEmployeeId: string,
  today: string,
  showCost: boolean,
): Promise<TeamDashboard | null> {
  const team = await tx
    .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.managerId, managerEmployeeId),
        eq(employees.status, "active"),
        isNull(employees.deletedAt),
      ),
    );
  if (team.length === 0) return null;
  const ids = team.map((t) => t.id);

  const cal = await loadCalendar(tx, organizationId, today, today);
  const dayType = classifyDay(today, cal.weeklyOffs, cal.holidays);

  const todayRecs = await tx
    .select()
    .from(attendanceRecords)
    .where(and(inArray(attendanceRecords.employeeId, ids), eq(attendanceRecords.date, today)));
  const onLeave = await tx
    .select({ e: leaveRequests.employeeId })
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.employeeId, ids),
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.fromDate, today),
        gte(leaveRequests.toDate, today),
      ),
    );
  const leaveSet = new Set(onLeave.map((l) => l.e));

  const members: TeamMember[] = team.map((t) => {
    const rec = todayRecs.find((r) => r.employeeId === t.id);
    let status: TeamStatus;
    if (leaveSet.has(t.id) || rec?.status === "leave") status = "on_leave";
    else if (rec?.checkIn) status = rec.lateMinutes > 0 ? "late" : "present";
    else if (rec?.status === "present" || rec?.status === "half_day") status = "present";
    else if (rec?.status === "absent") status = "absent";
    else status = dayType === "working" ? "not_in" : "off";
    return { id: t.id, name: `${t.first} ${t.last}`.trim(), status };
  });
  const counts: Record<TeamStatus, number> = {
    present: 0,
    late: 0,
    on_leave: 0,
    absent: 0,
    not_in: 0,
    off: 0,
  };
  for (const m of members) counts[m.status]++;

  const [{ n: leavePending }] = await tx
    .select({ n: count() })
    .from(leaveRequests)
    .where(and(inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "pending")));
  const [{ n: expPending }] = await tx
    .select({ n: count() })
    .from(expenseClaims)
    .where(and(inArray(expenseClaims.employeeId, ids), eq(expenseClaims.status, "submitted")));

  let monthlyCost: number | null = null;
  if (showCost) {
    const [c] = await tx
      .select({ v: sql<string>`coalesce(sum(${employeeSalaries.ctcAnnual}), 0)` })
      .from(employeeSalaries)
      .where(
        and(
          inArray(employeeSalaries.employeeId, ids),
          lte(employeeSalaries.effectiveFrom, `${today.slice(0, 7)}-28`),
          sql`not exists (select 1 from employee_salaries n where n.employee_id = ${employeeSalaries.employeeId} and n.effective_from > ${employeeSalaries.effectiveFrom} and n.effective_from <= ${`${today.slice(0, 7)}-28`})`,
        ),
      );
    monthlyCost = Math.round(Number(c?.v ?? 0) / 12);
  }

  // Attendance patterns over the last 30 days: counts only, no scoring or prediction.
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recent = await tx
    .select({
      e: attendanceRecords.employeeId,
      late: sql<number>`count(*) filter (where ${attendanceRecords.lateMinutes} > 0)::int`,
      absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'absent')::int`,
    })
    .from(attendanceRecords)
    .where(
      and(
        inArray(attendanceRecords.employeeId, ids),
        gte(attendanceRecords.date, since),
        lte(attendanceRecords.date, today),
      ),
    )
    .groupBy(attendanceRecords.employeeId);
  const signals: Signal[] = recent
    .filter((r) => r.late >= 4 || r.absent >= 3)
    .map((r) => ({
      employeeId: r.e,
      name: members.find((m) => m.id === r.e)?.name ?? "",
      lateDays: r.late,
      absentDays: r.absent,
    }))
    .sort((a, b) => b.absentDays * 2 + b.lateDays - (a.absentDays * 2 + a.lateDays));

  return {
    members,
    counts,
    pending: { leave: leavePending, expenses: expPending },
    monthlyCost,
    signals,
  };
}
