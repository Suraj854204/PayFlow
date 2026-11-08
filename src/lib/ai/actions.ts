import "server-only";
import { and, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/auth/context";
import type { Tx } from "@/lib/db";
import {
  departments,
  employeeSalaries,
  employees,
  leaveRequests,
  leaveTypes,
  payrollRuns,
  type AiActionKind,
  type AiActionPreview,
} from "@/lib/db/schema";
import { formatINR } from "@/lib/money";
import { monthLabel } from "@/lib/payroll/period";
import { eligibleEmployees } from "@/lib/payroll/service";
import { can, type Permission } from "@/lib/rbac";

/** What the assistant is allowed to propose. Each needs a human to confirm it before anything runs. */
export interface ProposalEnv {
  ctx: AppContext;
  today: string;
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}
export type Proposal =
  | { ok: true; params: Record<string, unknown>; preview: AiActionPreview }
  | { ok: false; error: string };

export interface ActionDef {
  kind: AiActionKind;
  /** The caller needs at least one of these to even propose it. Execution re-checks. */
  anyOf: Permission[];
  /** Needs a typed "CONFIRM" on top of the confirm button. */
  destructive: boolean;
}

export const ACTIONS: Record<AiActionKind, ActionDef> = {
  approve_leave: { kind: "approve_leave", anyOf: ["leave:approve"], destructive: false },
  reject_leave: { kind: "reject_leave", anyOf: ["leave:approve"], destructive: false },
  create_payroll_draft: {
    kind: "create_payroll_draft",
    anyOf: ["payroll:create"],
    destructive: false,
  },
  department_raise: { kind: "department_raise", anyOf: ["salary:write"], destructive: true },
  cancel_payroll_run: {
    kind: "cancel_payroll_run",
    anyOf: ["payroll:create", "payroll:approve"],
    destructive: true,
  },
};

export const CONFIRM_WORD = "CONFIRM";
export const ACTION_TTL_MS = 15 * 60_000;
export const MAX_RAISE_PERCENT = 25;
export const MAX_RAISE_EMPLOYEES = 200;

const fail = (error: string): Proposal => ({ ok: false, error });
const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const nextMonthStart = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
};

// ---- leave -----------------------------------------------------------------

export const leaveArgs = z.object({
  employeeName: z.string().trim().min(2).max(80).describe("Name (or part of it) of the employee."),
});

export async function proposeLeaveDecision(
  env: ProposalEnv,
  a: z.infer<typeof leaveArgs>,
  approve: boolean,
): Promise<Proposal> {
  const { ctx } = env;
  const rows = await env.db((tx) =>
    tx
      .select({ r: leaveRequests, e: employees, t: leaveTypes })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.organizationId, ctx.organizationId),
          eq(leaveRequests.status, "pending"),
          sql`(${employees.firstName} || ' ' || coalesce(${employees.lastName}, '')) ilike ${`%${a.employeeName.replace(/[%_]/g, "")}%`}`,
          // HR sees everyone; a manager only people who report to them. Never their own request.
          ...(can(ctx.role, "leave:manage")
            ? []
            : [eq(employees.managerId, ctx.employeeId ?? "00000000-0000-0000-0000-000000000000")]),
        ),
      )
      .limit(6),
  );
  const mine = rows.filter((x) => x.e.id !== ctx.employeeId);
  if (mine.length === 0)
    return fail(
      `No pending leave request from "${a.employeeName}" that you are allowed to decide.`,
    );
  if (mine.length > 1)
    return fail(
      `More than one pending request matches: ${mine
        .map(
          (x) =>
            `${x.e.firstName} ${x.e.lastName ?? ""}`.trim() +
            ` (${dateLabel(x.r.fromDate)} to ${dateLabel(x.r.toDate)})`,
        )
        .join("; ")}. Ask the user to be more specific.`,
    );
  const { r, e, t } = mine[0];
  const name = `${e.firstName} ${e.lastName ?? ""}`.trim();
  const verb = approve ? "Approve" : "Reject";
  return {
    ok: true,
    params: { requestId: r.id, approve },
    preview: {
      title: `${verb} ${name}'s leave`,
      summary: `${verb} ${t.name} for ${name}, ${dateLabel(r.fromDate)} to ${dateLabel(r.toDate)} (${Number(r.days)} day${Number(r.days) === 1 ? "" : "s"}).`,
      changes: [
        { label: "Leave request", before: "Pending", after: approve ? "Approved" : "Rejected" },
        ...(approve && t.isPaid
          ? [{ label: `${t.name} balance`, after: `${Number(r.days)} day(s) deducted` }]
          : []),
        ...(approve ? [{ label: "Attendance", after: "Marked as leave on working days" }] : []),
        { label: "Employee", after: "Notified of the decision" },
      ],
      warnings: r.reason ? [`Reason given: ${r.reason}`] : [],
    },
  };
}

// ---- payroll ---------------------------------------------------------------

export const draftArgs = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
    .describe("Month as YYYY-MM."),
});

export async function proposePayrollDraft(
  env: ProposalEnv,
  a: z.infer<typeof draftArgs>,
): Promise<Proposal> {
  if (a.month > env.today.slice(0, 7)) return fail("Payroll cannot be run for a future month.");
  const out = await env.db(async (tx) => {
    const [existing] = await tx
      .select({ id: payrollRuns.id, status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.organizationId, env.ctx.organizationId),
          eq(payrollRuns.month, a.month),
          sql`${payrollRuns.status} <> 'cancelled'`,
        ),
      );
    if (existing) return { existing: existing.status };
    const emps = await eligibleEmployees(tx, env.ctx.organizationId, a.month);
    return { count: emps.length };
  });
  if ("existing" in out)
    return fail(`A ${out.existing} payroll run already exists for ${monthLabel(a.month)}.`);
  if (!out.count) return fail(`No employees are eligible for ${monthLabel(a.month)} payroll.`);
  return {
    ok: true,
    params: { month: a.month },
    preview: {
      title: `Create ${monthLabel(a.month)} payroll draft`,
      summary: `Calculates pay for ${out.count} eligible employee${out.count === 1 ? "" : "s"}. Nothing is approved or paid.`,
      changes: [
        { label: "Payroll run", before: "None", after: `Draft for ${monthLabel(a.month)}` },
        { label: "Employees included", after: String(out.count) },
      ],
      warnings: [],
    },
  };
}

export const cancelArgs = draftArgs;
export async function proposeCancelRun(
  env: ProposalEnv,
  a: z.infer<typeof cancelArgs>,
): Promise<Proposal> {
  const { ctx } = env;
  const [run] = await env.db((tx) =>
    tx
      .select()
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.organizationId, ctx.organizationId),
          eq(payrollRuns.month, a.month),
          sql`${payrollRuns.status} <> 'cancelled'`,
        ),
      ),
  );
  if (!run) return fail(`There is no active payroll run for ${monthLabel(a.month)}.`);
  const allowed =
    run.status === "draft"
      ? can(ctx.role, "payroll:create")
      : (run.status === "review" || run.status === "approved") && can(ctx.role, "payroll:approve");
  if (!allowed) return fail(`A run that is ${run.status} cannot be cancelled by you.`);
  return {
    ok: true,
    params: { runId: run.id },
    preview: {
      title: `Cancel ${monthLabel(a.month)} payroll`,
      summary: `Cancels the ${run.status} run covering ${run.employeeCount} employees (net ${formatINR(run.totalNet)}). A new run can be created afterwards.`,
      changes: [{ label: "Payroll run", before: run.status, after: "cancelled" }],
      warnings: ["This cannot be undone."],
    },
  };
}

// ---- salary ----------------------------------------------------------------

export const raiseArgs = z.object({
  department: z.string().trim().min(2).max(80),
  percent: z
    .number()
    .min(0.5)
    .max(MAX_RAISE_PERCENT)
    .describe("Percentage increase in annual CTC."),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD. Defaults to the first of next month."),
});

export interface RaiseItem {
  employeeId: string;
  name: string;
  structureId: string;
  oldCtc: number;
  newCtc: number;
}

export async function proposeDepartmentRaise(
  env: ProposalEnv,
  a: z.infer<typeof raiseArgs>,
): Promise<Proposal> {
  const { ctx } = env;
  const effectiveFrom = a.effectiveFrom ?? nextMonthStart(env.today);
  if (effectiveFrom < env.today) return fail("The effective date cannot be in the past.");
  const found = await env.db(async (tx) => {
    const [dept] = await tx
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.organizationId, ctx.organizationId),
          ilike(departments.name, a.department.replace(/[%_]/g, "")),
        ),
      );
    if (!dept) return null;
    const emps = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, ctx.organizationId),
          eq(employees.departmentId, dept.id),
          eq(employees.status, "active"),
          isNull(employees.deletedAt),
        ),
      );
    const ids = emps.map((e) => e.id);
    const sal = ids.length
      ? await tx
          .select()
          .from(employeeSalaries)
          .where(
            and(
              eq(employeeSalaries.organizationId, ctx.organizationId),
              inArray(employeeSalaries.employeeId, ids),
            ),
          )
          .orderBy(desc(employeeSalaries.effectiveFrom))
      : [];
    return { dept, emps, sal };
  });
  if (!found) return fail(`There is no department called "${a.department}".`);
  const latest = new Map<string, (typeof found.sal)[number]>();
  for (const s of found.sal) if (!latest.has(s.employeeId)) latest.set(s.employeeId, s);
  const items: RaiseItem[] = [];
  const skipped: string[] = [];
  for (const e of found.emps) {
    const s = latest.get(e.id);
    const name = `${e.firstName} ${e.lastName ?? ""}`.trim();
    if (!s || !s.structureId || s.effectiveFrom >= effectiveFrom) {
      skipped.push(name);
      continue;
    }
    items.push({
      employeeId: e.id,
      name,
      structureId: s.structureId,
      oldCtc: s.ctcAnnual,
      newCtc: Math.round((s.ctcAnnual * (100 + a.percent)) / 100),
    });
  }
  if (items.length === 0)
    return fail(
      `No one in ${found.dept.name} can be revised on ${effectiveFrom}${skipped.length ? ` (${skipped.length} skipped: no salary on record, or already revised on or after that date)` : ""}.`,
    );
  if (items.length > MAX_RAISE_EMPLOYEES)
    return fail("That department is too large for one AI action.");
  const totalOld = items.reduce((s, i) => s + i.oldCtc, 0);
  const totalNew = items.reduce((s, i) => s + i.newCtc, 0);
  return {
    ok: true,
    params: { department: found.dept.name, percent: a.percent, effectiveFrom, items },
    preview: {
      title: `Raise ${found.dept.name} pay by ${a.percent}%`,
      summary: `Revises annual CTC for ${items.length} employee${items.length === 1 ? "" : "s"} from ${dateLabel(effectiveFrom)}. Annual cost rises by ${formatINR(totalNew - totalOld)}.`,
      changes: [
        ...items.slice(0, 5).map((i) => ({
          label: i.name,
          before: formatINR(i.oldCtc),
          after: formatINR(i.newCtc),
        })),
        ...(items.length > 5
          ? [{ label: `…and ${items.length - 5} more`, after: "same rate" }]
          : []),
        { label: "Total annual CTC", before: formatINR(totalOld), after: formatINR(totalNew) },
      ],
      warnings: [
        "Salary history is append-only: this adds a revision, it does not overwrite.",
        ...(skipped.length
          ? [`${skipped.length} skipped (no salary on record, or already revised).`]
          : []),
      ],
    },
  };
}
