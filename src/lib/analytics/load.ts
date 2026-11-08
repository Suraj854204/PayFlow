import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  attendanceRecords,
  departments,
  designations,
  employeeSalaries,
  employees,
  payrollRuns,
  salaryBenchmarks,
  surveyResponses,
} from "@/lib/db/schema";
import type { AttritionFacts, DeptMood } from "./attrition";
import type { PayPerson } from "./equity";

const LIVE = ["active", "probation", "notice"] as const;

export interface AnalyticsData {
  people: (AttritionFacts & PayPerson & { department: string | null; managerId: string | null })[];
  moodByDept: Map<string, DeptMood>;
  benchmarks: Map<
    string,
    { p25: number; p50: number; p75: number; source: string; asOf: string; title: string }
  >;
  designationTitles: { id: string; title: string }[];
  lastRun: { month: string; employerCost: number; employees: number } | null;
  recentCosts: { month: string; value: number }[];
}

const daysAgo = (today: string, n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Everything the analytics pages need, read once. Tenant scoping comes from the transaction (RLS) plus explicit filters. */
export async function loadAnalytics(tx: Tx, orgId: string, today: string): Promise<AnalyticsData> {
  const emps = await tx
    .select({
      e: employees,
      dept: departments.name,
      desig: designations.title,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(
      and(
        eq(employees.organizationId, orgId),
        isNull(employees.deletedAt),
        inArray(employees.status, [...LIVE]),
      ),
    );
  const ids = emps.map((r) => r.e.id);

  const sal = ids.length
    ? await tx
        .select({
          employeeId: employeeSalaries.employeeId,
          ctc: employeeSalaries.ctcAnnual,
          from: employeeSalaries.effectiveFrom,
        })
        .from(employeeSalaries)
        .where(
          and(
            eq(employeeSalaries.organizationId, orgId),
            inArray(employeeSalaries.employeeId, ids),
          ),
        )
        .orderBy(desc(employeeSalaries.effectiveFrom))
    : [];
  const latest = new Map<string, { ctc: number; from: string }>();
  for (const s of sal)
    if (!latest.has(s.employeeId)) latest.set(s.employeeId, { ctc: s.ctc, from: s.from });

  const since180 = daysAgo(today, 180);
  const since90 = daysAgo(today, 90);
  const att = ids.length
    ? await tx
        .select({
          employeeId: attendanceRecords.employeeId,
          recent: sql<number>`coalesce(sum(case when ${attendanceRecords.status} = 'absent' and ${attendanceRecords.date} >= ${since90} then 1 else 0 end),0)::int`,
          prev: sql<number>`coalesce(sum(case when ${attendanceRecords.status} = 'absent' and ${attendanceRecords.date} < ${since90} then 1 else 0 end),0)::int`,
          ot: sql<number>`coalesce(sum(case when ${attendanceRecords.date} >= ${since90} then ${attendanceRecords.overtimeMinutes} else 0 end),0)::int`,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.organizationId, orgId),
            gte(attendanceRecords.date, since180),
            inArray(attendanceRecords.employeeId, ids),
          ),
        )
        .groupBy(attendanceRecords.employeeId)
    : [];
  const attBy = new Map(att.map((a) => [a.employeeId, a]));

  const people = emps
    .filter((r) => latest.has(r.e.id))
    .map((r) => {
      const s = latest.get(r.e.id)!;
      const a = attBy.get(r.e.id);
      return {
        id: r.e.id,
        name: `${r.e.firstName} ${r.e.lastName}`.trim(),
        peerGroup: r.e.designationId,
        role: r.e.designationId ?? "none",
        roleLabel: r.desig ?? "No designation",
        departmentId: r.e.departmentId,
        department: r.dept,
        managerId: r.e.managerId,
        gender: r.e.gender as PayPerson["gender"],
        joinDate: r.e.joinDate,
        ctcAnnual: s.ctc,
        lastRevisionDate: s.from > r.e.joinDate ? s.from : r.e.joinDate,
        absentDaysLast90: a?.recent ?? 0,
        absentDaysPrev90: a?.prev ?? 0,
        overtimeMinutesLast90: a?.ot ?? 0,
      };
    });

  const resp = await tx
    .select({ dept: surveyResponses.departmentId, sentiment: surveyResponses.sentiment })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.organizationId, orgId),
        gte(surveyResponses.submittedOn, daysAgo(today, 120)),
      ),
    );
  const moodByDept = new Map<string, DeptMood>();
  for (const r of resp) {
    if (!r.dept) continue;
    const m = moodByDept.get(r.dept) ?? { responses: 0, negativeShare: 0 };
    m.negativeShare =
      (m.negativeShare * m.responses + (r.sentiment === "negative" ? 1 : 0)) / (m.responses + 1);
    m.responses += 1;
    moodByDept.set(r.dept, m);
  }

  const bm = await tx
    .select({ b: salaryBenchmarks, title: designations.title })
    .from(salaryBenchmarks)
    .innerJoin(designations, eq(designations.id, salaryBenchmarks.designationId))
    .where(eq(salaryBenchmarks.organizationId, orgId));
  const benchmarks = new Map(
    bm.map((r) => [
      r.b.designationId,
      {
        p25: r.b.p25,
        p50: r.b.p50,
        p75: r.b.p75,
        source: r.b.source,
        asOf: r.b.asOf,
        title: r.title,
      },
    ]),
  );
  const designationTitles = await tx
    .select({ id: designations.id, title: designations.title })
    .from(designations)
    .where(eq(designations.organizationId, orgId))
    .orderBy(designations.title);

  const runs = await tx
    .select({
      month: payrollRuns.month,
      cost: payrollRuns.totalEmployerCost,
      n: payrollRuns.employeeCount,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, orgId),
        inArray(payrollRuns.status, ["approved", "processing", "paid"]),
        lt(payrollRuns.month, "9999-99"),
      ),
    )
    .orderBy(desc(payrollRuns.month))
    .limit(6);
  const lastRun = runs[0]
    ? { month: runs[0].month, employerCost: Number(runs[0].cost), employees: runs[0].n }
    : null;
  return {
    people,
    moodByDept,
    benchmarks,
    designationTitles,
    lastRun,
    recentCosts: [...runs].reverse().map((r) => ({ month: r.month, value: Number(r.cost) })),
  };
}
