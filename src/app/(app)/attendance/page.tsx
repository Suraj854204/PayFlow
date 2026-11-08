import Link from "next/link";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckPanel } from "@/components/attendance/check-panel";
import { MonthCalendar, type DayCell } from "@/components/attendance/month-calendar";
import {
  LockPanel,
  ManualForm,
  ShiftForms,
  WorkplaceForm,
} from "@/components/attendance/admin-panel";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import {
  attendanceLocks,
  attendanceRecords,
  employees,
  organizations,
  shifts,
} from "@/lib/db/schema";
import { classifyDay, monthDates } from "@/lib/attendance/calendar";
import { dateInTz } from "@/lib/attendance/calc";
import { MONTH_RE, addMonths, monthLabel } from "@/lib/payroll/period";
import { can } from "@/lib/rbac";
import { loadCalendar } from "@/lib/workforce/calendar";
import { redirect } from "next/navigation";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requireContext();
  const manage = can(ctx.role, "attendance:manage");
  const team = manage || can(ctx.role, "attendance:read_team");
  const own = can(ctx.role, "attendance:read_own") && Boolean(ctx.employeeId);
  if (!manage && !team && !own) redirect("/dashboard?denied=1");

  const sp = await searchParams;
  const nowMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : nowMonth;
  const dates = monthDates(month);

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const cal = await loadCalendar(tx, ctx.organizationId, dates[0], dates[dates.length - 1]);
    const today = dateInTz(new Date(), cal.tz);
    const [lock] = await tx
      .select({ id: attendanceLocks.id })
      .from(attendanceLocks)
      .where(
        and(
          eq(attendanceLocks.organizationId, ctx.organizationId),
          eq(attendanceLocks.month, month),
        ),
      );
    const mine = ctx.employeeId
      ? await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.employeeId, ctx.employeeId),
              gte(attendanceRecords.date, dates[0]),
              lte(attendanceRecords.date, dates[dates.length - 1]),
            ),
          )
      : [];
    const openRec = ctx.employeeId
      ? (
          await tx
            .select()
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.employeeId, ctx.employeeId),
                eq(attendanceRecords.date, today),
              ),
            )
        )[0]
      : undefined;
    let people: { id: string; name: string }[] = [];
    let rows: (typeof attendanceRecords.$inferSelect)[] = [];
    if (team) {
      const scope = manage
        ? and(eq(employees.organizationId, ctx.organizationId), isNull(employees.deletedAt))
        : and(
            eq(employees.organizationId, ctx.organizationId),
            isNull(employees.deletedAt),
            or(eq(employees.managerId, ctx.employeeId ?? "00000000-0000-0000-0000-000000000000")),
          );
      const emps = await tx
        .select({ id: employees.id, f: employees.firstName, l: employees.lastName })
        .from(employees)
        .where(scope)
        .orderBy(asc(employees.firstName));
      people = emps.map((e) => ({ id: e.id, name: `${e.f} ${e.l}`.trim() }));
      if (people.length)
        rows = await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.organizationId, ctx.organizationId),
              gte(attendanceRecords.date, dates[0]),
              lte(attendanceRecords.date, dates[dates.length - 1]),
            ),
          );
    }
    const [org] = await tx
      .select({
        lat: organizations.geofenceLat,
        lng: organizations.geofenceLng,
        r: organizations.geofenceRadiusM,
        w: organizations.weeklyOffs,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    const sh = manage
      ? await tx
          .select()
          .from(shifts)
          .where(and(eq(shifts.organizationId, ctx.organizationId), isNull(shifts.deletedAt)))
      : [];
    return { cal, today, locked: Boolean(lock), mine, openRec, people, rows, org, sh };
  });

  const byDate = new Map(data.mine.map((r) => [r.date, r]));
  const cells: DayCell[] = dates.map((d) => {
    const r = byDate.get(d);
    if (r)
      return {
        date: d,
        kind: r.status,
        title: `${r.status.replace("_", " ")}${r.lateMinutes ? ` · late ${r.lateMinutes}m` : ""}${r.workedMinutes ? ` · ${Math.floor(r.workedMinutes / 60)}h ${r.workedMinutes % 60}m` : ""}`,
      };
    const k = classifyDay(d, data.cal.weeklyOffs, data.cal.holidays);
    return { date: d, kind: k === "working" ? "none" : k };
  });

  const stats = data.people.map((p) => {
    const rs = data.rows.filter((r) => r.employeeId === p.id);
    const n = (s: string) => rs.filter((r) => r.status === s).length;
    return {
      ...p,
      present: n("present"),
      half: n("half_day"),
      absent: n("absent"),
      leave: n("leave"),
      late: rs.filter((r) => r.lateMinutes > 0).length,
      ot: rs.reduce((s, r) => s + r.overtimeMinutes, 0),
    };
  });

  const rec = data.openRec;
  const state = !rec
    ? "none"
    : rec.status === "leave"
      ? "leave"
      : rec.checkIn && !rec.checkOut
        ? "in"
        : rec.checkOut
          ? "done"
          : "none";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="text-muted-foreground text-sm">
            {monthLabel(month)}
            {data.locked ? " · locked for payroll" : ""}
          </p>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Month">
          <Link
            className="hover:bg-muted rounded-lg border px-3 py-1.5"
            href={`/attendance?month=${addMonths(month, -1)}`}
          >
            Previous
          </Link>
          <Link className="hover:bg-muted rounded-lg border px-3 py-1.5" href="/attendance">
            This month
          </Link>
          {month < nowMonth && (
            <Link
              className="hover:bg-muted rounded-lg border px-3 py-1.5"
              href={`/attendance?month=${addMonths(month, 1)}`}
            >
              Next
            </Link>
          )}
        </nav>
      </div>

      {own && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckPanel
                state={state}
                fenceOn={Boolean(data.cal.fence)}
                checkedInAt={rec?.checkIn?.toISOString()}
                checkedOutAt={rec?.checkOut?.toISOString()}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>My month</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthCalendar cells={cells} />
            </CardContent>
          </Card>
        </>
      )}

      {team && (
        <Card>
          <CardHeader>
            <CardTitle>{manage ? "Everyone" : "My team"}</CardTitle>
            <CardDescription>
              Days by status for the month. Overtime is shown in hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Present</th>
                  <th className="py-2 pr-4 font-medium">Half</th>
                  <th className="py-2 pr-4 font-medium">Absent</th>
                  <th className="py-2 pr-4 font-medium">Leave</th>
                  <th className="py-2 pr-4 font-medium">Late days</th>
                  <th className="py-2 font-medium">Overtime</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4">{s.name}</td>
                    <td className="py-2 pr-4 tabular-nums">{s.present}</td>
                    <td className="py-2 pr-4 tabular-nums">{s.half}</td>
                    <td className="py-2 pr-4 tabular-nums">{s.absent}</td>
                    <td className="py-2 pr-4 tabular-nums">{s.leave}</td>
                    <td className="py-2 pr-4 tabular-nums">{s.late}</td>
                    <td className="py-2 tabular-nums">{(s.ot / 60).toFixed(1)} h</td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-muted-foreground py-8 text-center">
                      No one reports to you yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {manage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Month close</CardTitle>
            </CardHeader>
            <CardContent>
              <LockPanel month={month} locked={data.locked} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Workplace</CardTitle>
              <CardDescription>Geo-fence and weekly offs.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorkplaceForm
                lat={data.org?.lat ?? null}
                lng={data.org?.lng ?? null}
                radius={data.org?.r ?? null}
                weeklyOffs={data.org?.w ?? [0]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Shifts and roster</CardTitle>
            </CardHeader>
            <CardContent>
              <ShiftForms
                shifts={data.sh.map((s) => ({
                  id: s.id,
                  name: s.name,
                  start: s.startTime,
                  end: s.endTime,
                }))}
                employees={data.people}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Correct a day</CardTitle>
            </CardHeader>
            <CardContent>
              <ManualForm employees={data.people} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
