import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/auth/context";
import { withTenant, type Tx } from "@/lib/db";
import {
  attendanceRecords,
  complianceItems,
  departments,
  employees,
  expenseClaims,
  leaveRequests,
  payrollItems,
  payrollRuns,
  payslips,
  taxDeclarations,
  type ChatChart,
  type ChatSource,
} from "@/lib/db/schema";
import { analyzeRun } from "@/lib/anomaly/load";
import { KIND_LABEL, type ComplianceKind } from "@/lib/compliance/calendar";
import { loadEmployeeDashboard } from "@/lib/dashboard/load-employee";
import { loadTeamDashboard } from "@/lib/dashboard/load-team";
import { formatINR } from "@/lib/money";
import { monthEnd, monthLabel, monthStart } from "@/lib/payroll/period";
import { can, canAny, type Permission } from "@/lib/rbac";
import {
  attritionByDepartment,
  chartFor,
  REPORT_KINDS,
  REPORT_LABEL,
  type ReportKind,
} from "@/lib/reports/builder";
import { loadReports } from "@/lib/reports/load";
import { sanitizeToolOutput } from "./guard";
import {
  cancelArgs,
  draftArgs,
  leaveArgs,
  proposeCancelRun,
  proposeDepartmentRaise,
  proposeLeaveDecision,
  proposePayrollDraft,
  raiseArgs,
} from "./actions";
import { searchPolicies } from "@/lib/policy/search";
import { storeProposal } from "./propose";
import type { ActionCard, ToolSpec } from "./types";

export interface ToolEnv {
  ctx: AppContext;
  /** IST date, YYYY-MM-DD. */
  today: string;
  /** Opens a short tenant-scoped transaction. Tools never hold one while the model is thinking. */
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** The conversation, so a proposed action can be shown again when it is reopened. */
  sessionId?: string;
}
export const toolEnv = (ctx: AppContext, today: string, sessionId?: string): ToolEnv => ({
  ctx,
  today,
  sessionId,
  db: (fn) => withTenant(ctx.organizationId, fn),
});

export interface ToolResult {
  data: Record<string, unknown>;
  sources?: ChatSource[];
  chart?: ChatChart;
  action?: ActionCard;
}

interface ToolDef<A extends z.ZodType> {
  name: string;
  label: string;
  description: string;
  /** The caller needs at least one of these. Empty means any signed-in user with an employee record. */
  anyOf: Permission[];
  /** The caller also needs every one of these (e.g. ai:act for anything that proposes a change). */
  allOf?: Permission[];
  needsEmployee?: boolean;
  schema: A;
  run: (env: ToolEnv, args: z.infer<A>) => Promise<ToolResult>;
}

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
  .optional()
  .describe("Month as YYYY-MM. Omit for the latest.");
const none = z.object({});
const ym = (today: string) => today.slice(0, 7);
const inr = (p: number) => formatINR(p);

async function latestRun(tx: Tx, orgId: string, m?: string) {
  const rows = await tx
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, orgId),
        sql`${payrollRuns.status} <> 'cancelled'`,
        ...(m ? [eq(payrollRuns.month, m)] : []),
      ),
    )
    .orderBy(desc(payrollRuns.month))
    .limit(1);
  return rows[0] ?? null;
}

/** Keeps each tool's argument type inferred from its own schema, then widens it for the registry. */
const tool = <A extends z.ZodType>(d: ToolDef<A>) => d as unknown as ToolDef<z.ZodType>;

const DEFS: ToolDef<z.ZodType>[] = [
  tool({
    name: "my_payslip",
    label: "Reading your payslip",
    description:
      "The signed-in user's own payslip for a month: earnings, deductions, gross and net pay.",
    anyOf: ["payslips:read_own"],
    needsEmployee: true,
    schema: z.object({ month }),
    run: async (env, a) => {
      const row = await env.db(async (tx) => {
        const rows = await tx
          .select({ i: payrollItems, m: payrollRuns.month, slip: payslips.id })
          .from(payrollItems)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
          .leftJoin(payslips, eq(payslips.itemId, payrollItems.id))
          .where(
            and(
              eq(payrollItems.employeeId, env.ctx.employeeId!),
              eq(payrollItems.onHold, false),
              inArray(payrollRuns.status, ["approved", "processing", "paid"]),
              ...(a.month ? [eq(payrollRuns.month, a.month)] : []),
            ),
          )
          .orderBy(desc(payrollRuns.month))
          .limit(1);
        return rows[0] ?? null;
      });
      if (!row)
        return {
          data: {
            found: false,
            note: a.month
              ? `No approved payslip for ${monthLabel(a.month)}.`
              : "No approved payslip yet.",
          },
        };
      const line = (l: { name: string; amount: number }) => ({
        name: l.name,
        amount: inr(l.amount),
      });
      return {
        data: {
          found: true,
          month: monthLabel(row.m),
          gross: inr(row.i.gross),
          totalDeductions: inr(row.i.totalDeductions),
          netPay: inr(row.i.net),
          paidDays: row.i.paidDays,
          lopDays: row.i.lopDays,
          earnings: row.i.earnings.map(line),
          deductions: row.i.deductions.map(line),
        },
        sources: [
          {
            title: `Payslip, ${monthLabel(row.m)}`,
            detail: `Net pay ${inr(row.i.net)}`,
            href: "/payslips",
          },
        ],
      };
    },
  }),
  tool({
    name: "my_leave_balance",
    label: "Checking your leave balance",
    description:
      "The signed-in user's remaining paid leave days by leave type for this financial year.",
    anyOf: ["leave:apply"],
    needsEmployee: true,
    schema: none,
    run: async (env) => {
      const d = await env.db((tx) =>
        loadEmployeeDashboard(tx, env.ctx.organizationId, env.ctx.employeeId!, env.today),
      );
      return {
        data: {
          balances: d.leave.map((l) => ({
            type: l.name,
            daysLeft: l.left,
            daysAllotted: l.allotted,
          })),
        },
        sources: [{ title: "Leave balances", href: "/leave" }],
      };
    },
  }),
  tool({
    name: "my_tax_summary",
    label: "Reviewing your tax position",
    description:
      "The signed-in user's tax regime, tax deducted so far, projected annual tax, declaration status, and personalised tax-saving suggestions based on what they have declared.",
    anyOf: ["tax:read_own"],
    needsEmployee: true,
    schema: none,
    run: async (env) => {
      const d = await env.db((tx) =>
        loadEmployeeDashboard(tx, env.ctx.organizationId, env.ctx.employeeId!, env.today),
      );
      return {
        data: {
          regime: d.tax.regime,
          declarationStatus: d.tax.status,
          taxDeductedThisYear: inr(d.tax.ytdTds),
          projectedAnnualTax: d.tax.annualTax === null ? "unknown" : inr(d.tax.annualTax),
          betterRegime: d.tax.betterRegime,
          possibleAnnualSaving: inr(d.tax.saving),
          suggestions: d.tips.map((t) => ({ title: t.title, detail: t.detail })),
        },
        sources: [{ title: "Tax declarations", href: "/tax" }],
      };
    },
  }),
  tool({
    name: "my_attendance",
    label: "Looking at your attendance",
    description:
      "The signed-in user's own attendance for a month: days present, absent, on leave and late.",
    anyOf: ["attendance:read_own"],
    needsEmployee: true,
    schema: z.object({ month }),
    run: async (env, a) => {
      const m = a.month ?? ym(env.today);
      const rows = await env.db((tx) =>
        tx
          .select({
            s: attendanceRecords.status,
            n: sql<number>`count(*)::int`,
            late: sql<number>`count(*) filter (where ${attendanceRecords.lateMinutes} > 0)::int`,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.employeeId, env.ctx.employeeId!),
              gte(attendanceRecords.date, monthStart(m)),
              lte(attendanceRecords.date, monthEnd(m)),
            ),
          )
          .groupBy(attendanceRecords.status),
      );
      const by = Object.fromEntries(rows.map((r) => [r.s, r.n]));
      return {
        data: {
          month: monthLabel(m),
          present: by.present ?? 0,
          halfDays: by.half_day ?? 0,
          absent: by.absent ?? 0,
          onLeave: by.leave ?? 0,
          lateArrivals: rows.reduce((s, r) => s + r.late, 0),
        },
        sources: [{ title: "Attendance", href: "/attendance" }],
      };
    },
  }),
  tool({
    name: "company_payroll_summary",
    label: "Summarising payroll",
    description:
      "Company-wide totals for a payroll run: status, employees, gross, deductions, net pay and employer cost.",
    anyOf: ["payroll:read"],
    schema: z.object({ month }),
    run: async (env, a) => {
      const r = await env.db((tx) => latestRun(tx, env.ctx.organizationId, a.month));
      if (!r)
        return { data: { found: false, note: "There is no payroll run for that month yet." } };
      return {
        data: {
          found: true,
          month: monthLabel(r.month),
          status: r.status,
          employees: r.employeeCount,
          gross: inr(r.totalGross),
          deductions: inr(r.totalDeductions),
          netPay: inr(r.totalNet),
          employerCost: inr(r.totalEmployerCost),
        },
        sources: [
          {
            title: `Payroll run, ${monthLabel(r.month)}`,
            detail: r.status,
            href: `/payroll/${r.id}`,
          },
        ],
      };
    },
  }),
  tool({
    name: "headcount_summary",
    label: "Counting headcount",
    description: "Active employee headcount, in total and by department.",
    anyOf: ["employees:read"],
    schema: none,
    run: async (env) => {
      const rows = await env.db((tx) =>
        tx
          .select({ d: departments.name, n: sql<number>`count(*)::int` })
          .from(employees)
          .leftJoin(departments, eq(departments.id, employees.departmentId))
          .where(
            and(
              eq(employees.organizationId, env.ctx.organizationId),
              eq(employees.status, "active"),
              isNull(employees.deletedAt),
            ),
          )
          .groupBy(departments.name)
          .orderBy(desc(sql`count(*)`)),
      );
      return {
        data: {
          total: rows.reduce((s, r) => s + r.n, 0),
          byDepartment: rows.map((r) => ({ department: r.d ?? "No department", count: r.n })),
        },
        sources: [{ title: "Employees", href: "/employees" }],
      };
    },
  }),
  tool({
    name: "pending_approvals",
    label: "Counting pending approvals",
    description:
      "How many leave requests, expense claims, tax declarations and payroll runs are waiting for a decision, within the signed-in user's authority.",
    anyOf: ["leave:approve", "expenses:approve", "payroll:approve", "tax:manage"],
    schema: none,
    run: async (env) => {
      const orgWide = canAny(env.ctx.role, ["leave:manage", "payroll:read"]);
      const out = await env.db(async (tx) => {
        if (orgWide) {
          const c = async (
            t:
              | typeof leaveRequests
              | typeof expenseClaims
              | typeof taxDeclarations
              | typeof payrollRuns,
            status: string,
          ) => {
            const [r] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(t)
              .where(
                and(
                  eq(t.organizationId, env.ctx.organizationId),
                  eq((t as typeof leaveRequests).status, status as "pending"),
                ),
              );
            return r?.n ?? 0;
          };
          return {
            scope: "company",
            leaveRequests: await c(leaveRequests, "pending"),
            expenseClaims: await c(expenseClaims, "submitted" as never),
            taxDeclarations: await c(taxDeclarations, "submitted" as never),
            payrollRunsInReview: await c(payrollRuns, "review" as never),
          };
        }
        const t = env.ctx.employeeId
          ? await loadTeamDashboard(
              tx,
              env.ctx.organizationId,
              env.ctx.employeeId,
              env.today,
              false,
            )
          : null;
        return {
          scope: "your direct reports",
          leaveRequests: t?.pending.leave ?? 0,
          expenseClaims: t?.pending.expenses ?? 0,
        };
      });
      return {
        data: out,
        sources: [
          { title: "Leave requests", href: "/leave" },
          { title: "Expense claims", href: "/expenses" },
        ],
      };
    },
  }),
  tool({
    name: "team_attendance_today",
    label: "Checking your team's attendance",
    description:
      "Today's attendance for the signed-in manager's direct reports: who is in, late, on leave or absent.",
    anyOf: ["employees:read_team"],
    needsEmployee: true,
    schema: none,
    run: async (env) => {
      const t = await env.db((tx) =>
        loadTeamDashboard(tx, env.ctx.organizationId, env.ctx.employeeId!, env.today, false),
      );
      if (!t) return { data: { found: false, note: "You have no direct reports." } };
      return {
        data: {
          found: true,
          counts: t.counts,
          members: t.members.map((m) => ({ name: m.name, status: m.status })),
        },
        sources: [{ title: "Dashboard, My team", href: "/dashboard?view=team" }],
      };
    },
  }),
  tool({
    name: "compliance_due",
    label: "Looking at compliance deadlines",
    description: "Statutory filings (PF, ESI, PT, TDS) that are overdue or due within 30 days.",
    anyOf: ["payroll:read"],
    schema: none,
    run: async (env) => {
      const horizon = new Date(Date.parse(`${env.today}T00:00:00Z`) + 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const rows = await env.db((tx) =>
        tx
          .select()
          .from(complianceItems)
          .where(
            and(
              eq(complianceItems.organizationId, env.ctx.organizationId),
              eq(complianceItems.status, "pending"),
              lte(complianceItems.dueDate, horizon),
            ),
          )
          .orderBy(asc(complianceItems.dueDate))
          .limit(12),
      );
      return {
        data: {
          today: env.today,
          items: rows.map((r) => ({
            filing: KIND_LABEL[r.kind as ComplianceKind] ?? r.kind,
            forPeriod: r.period,
            dueDate: r.dueDate,
            overdue: r.dueDate < env.today,
          })),
        },
        sources: [{ title: "Compliance calendar", href: "/compliance" }],
      };
    },
  }),
  tool({
    name: "check_payroll_run",
    label: "Reviewing the payroll run",
    description:
      "Runs the pre-approval checklist and anomaly detection on a payroll run: missing bank details, unlocked attendance, pay spikes, abnormal deductions, ghost employees, shared bank accounts.",
    anyOf: ["payroll:read"],
    schema: z.object({ month }),
    run: async (env, a) => {
      const r = await env.db((tx) => latestRun(tx, env.ctx.organizationId, a.month));
      if (!r) return { data: { found: false, note: "There is no payroll run to review yet." } };
      const an = await env.db((tx) => analyzeRun(tx, env.ctx.organizationId, r.id, env.today));
      if (!an) return { data: { found: false } };
      return {
        data: {
          found: true,
          month: monthLabel(an.month),
          status: an.status,
          readyForApproval: an.summary.ready,
          failingChecks: an.checks
            .filter((c) => c.status === "fail")
            .map((c) => ({ title: c.title, detail: c.detail })),
          warnings: an.checks
            .filter((c) => c.status === "warn")
            .map((c) => ({ title: c.title, detail: c.detail })),
          anomalies: an.anomalies.slice(0, 10).map((x) => ({
            severity: x.severity,
            title: x.title,
            why: x.explanation,
            whatToDo: x.suggestion,
          })),
          anomaliesDismissedWithReason: an.dismissed.length,
        },
        sources: [
          {
            title: `Payroll run, ${monthLabel(an.month)}`,
            detail: "Open to review and dismiss",
            href: `/payroll/${r.id}`,
          },
        ],
      };
    },
  }),
  tool({
    name: "build_report",
    label: "Building the report",
    description: `Builds a chart for one of the supported reports: ${REPORT_KINDS.map((k) => `${k} (${REPORT_LABEL[k]})`).join("; ")}. Pick the closest match to what the user asked for.`,
    anyOf: ["reports:read"],
    schema: z.object({ kind: z.enum(REPORT_KINDS) }),
    run: async (env, a) => {
      const kind: ReportKind = a.kind;
      const m = ym(env.today);
      const points = await env.db(async (tx) => {
        if (kind === "attrition_by_department") {
          const people = await tx
            .select({
              department: departments.name,
              joinDate: employees.joinDate,
              exitDate: employees.exitDate,
            })
            .from(employees)
            .leftJoin(departments, eq(departments.id, employees.departmentId))
            .where(eq(employees.organizationId, env.ctx.organizationId));
          return attritionByDepartment(
            people.map((p) => ({ ...p, department: p.department ?? "No department" })),
            m,
          ).map((r) => ({ label: r.department, value: r.ratePct }));
        }
        const rep = await loadReports(tx, env.ctx.organizationId, m);
        if (kind === "cost_by_department")
          return rep.departments.map((d) => ({ label: d.department, value: d.cost }));
        if (kind === "payroll_cost_trend")
          return rep.trend.map((t) => ({ label: t.month, value: t.employerCost }));
        if (kind === "headcount_trend")
          return rep.headcount.map((h) => ({ label: h.month, value: h.headcount }));
        return rep.overtime.map((o) => ({
          label: o.month,
          value: Math.round((o.minutes / 60) * 10) / 10,
        }));
      });
      const chart = chartFor(kind, points);
      const fmt = (v: number) =>
        chart.unit === "inr" ? inr(v) : chart.unit === "percent" ? `${v}%` : String(v);
      return {
        data: {
          report: chart.title,
          rows: points.map((p) => ({ label: p.label, value: fmt(p.value) })),
          note: points.length ? undefined : "There is no data for this report yet.",
        },
        chart,
        sources: [{ title: "Reports", href: "/reports" }],
      };
    },
  }),
  tool({
    name: "policy_search",
    label: "Searching HR policies",
    description:
      "Search the company's uploaded HR policies for passages that answer a question (leave rules, notice period, work from home, reimbursements...). Answer only from the passages and cite them as [1], [2].",
    anyOf: ["policies:read"],
    schema: z.object({ question: z.string().trim().min(3).max(300) }),
    run: async (env, a) => {
      const { hits, mode } = await env.db((tx) =>
        searchPolicies(tx, env.ctx.organizationId, a.question, 4),
      );
      if (hits.length === 0)
        return {
          data: {
            found: false,
            note: "No uploaded policy covers this. Say so and suggest asking HR; do not answer from general knowledge as if it were company policy.",
          },
        };
      return {
        data: {
          found: true,
          mode,
          passages: hits.map((h, i) => ({
            ref: i + 1,
            document: h.title,
            page: h.page,
            text: h.content.slice(0, 900),
          })),
        },
        sources: hits.map((h) => ({
          title: h.title,
          detail: `Page ${h.page}`,
          href: `/policies/${h.documentId}#page-${h.page}`,
        })),
      };
    },
  }),
  // ---- Actions. These only PROPOSE: a person must confirm on a card before anything changes.
  tool({
    name: "propose_approve_leave",
    label: "Preparing a leave approval",
    description:
      "Propose approving a pending leave request, by employee name. Shows a confirmation card; nothing changes until the user confirms. Never claim it is done.",
    allOf: ["ai:act"],
    anyOf: ["leave:approve"],
    schema: leaveArgs,
    run: async (env, a) =>
      storeProposal(env, "approve_leave", await proposeLeaveDecision(env, a, true)),
  }),
  tool({
    name: "propose_reject_leave",
    label: "Preparing a leave rejection",
    description:
      "Propose rejecting a pending leave request, by employee name. Shows a confirmation card; nothing changes until the user confirms.",
    allOf: ["ai:act"],
    anyOf: ["leave:approve"],
    schema: leaveArgs,
    run: async (env, a) =>
      storeProposal(env, "reject_leave", await proposeLeaveDecision(env, a, false)),
  }),
  tool({
    name: "propose_create_payroll_draft",
    label: "Preparing a payroll draft",
    description:
      "Propose creating a draft payroll run for a month. Shows a confirmation card; nothing changes until the user confirms.",
    allOf: ["ai:act"],
    anyOf: ["payroll:create"],
    schema: draftArgs,
    run: async (env, a) =>
      storeProposal(env, "create_payroll_draft", await proposePayrollDraft(env, a)),
  }),
  tool({
    name: "propose_department_raise",
    label: "Preparing a salary revision",
    description:
      "Propose raising annual CTC for everyone in a department by a percentage (max 25%). Shows a confirmation card listing the changes; the user must type CONFIRM. Nothing changes until then.",
    allOf: ["ai:act"],
    anyOf: ["salary:write"],
    schema: raiseArgs,
    run: async (env, a) =>
      storeProposal(env, "department_raise", await proposeDepartmentRaise(env, a)),
  }),
  tool({
    name: "propose_cancel_payroll_run",
    label: "Preparing a payroll cancellation",
    description:
      "Propose cancelling the active payroll run for a month. Destructive: the user must type CONFIRM on the card.",
    allOf: ["ai:act"],
    anyOf: ["payroll:create", "payroll:approve"],
    schema: cancelArgs,
    run: async (env, a) => storeProposal(env, "cancel_payroll_run", await proposeCancelRun(env, a)),
  }),
];

type AnyTool = ToolDef<z.ZodType>;
const BY_NAME = new Map<string, AnyTool>(DEFS.map((d) => [d.name, d]));

/** Tools this user may call. Only these are ever shown to the model. */
export function toolsFor(ctx: AppContext): ToolSpec[] {
  return DEFS.filter((d) => allowed(ctx, d)).map((d) => ({
    name: d.name,
    description: d.description,
    parameters: z.toJSONSchema(d.schema, { target: "draft-7" }) as Record<string, unknown>,
  }));
}
function allowed(ctx: AppContext, d: Pick<AnyTool, "anyOf" | "allOf" | "needsEmployee">): boolean {
  if (d.needsEmployee && !ctx.employeeId) return false;
  if (d.allOf?.some((p) => !can(ctx.role, p))) return false;
  return d.anyOf.length === 0 || d.anyOf.some((p) => can(ctx.role, p));
}
export const toolLabel = (name: string) => BY_NAME.get(name)?.label ?? "Working";

export type ToolRun =
  | {
      status: "ok";
      response: Record<string, unknown>;
      sources: ChatSource[];
      chart?: ChatChart;
      action?: ActionCard;
    }
  | { status: "denied" | "error"; response: Record<string, unknown> };

const ChartSchema = z.object({
  kind: z.enum(["bar", "line", "donut"]),
  title: z.string().max(200),
  unit: z.enum(["inr", "count", "percent"]),
  points: z.array(z.object({ label: z.string().max(80), value: z.number().finite() })).max(40),
});

/**
 * The only way the model touches data. Re-checks permission on the server for every call (never
 * trusting that the tool was offered), validates arguments, and sanitises what comes back.
 */
export async function executeTool(env: ToolEnv, name: string, rawArgs: unknown): Promise<ToolRun> {
  const def = BY_NAME.get(name);
  if (!def) return { status: "error", response: { error: "Unknown tool." } };
  if (!allowed(env.ctx, def))
    return {
      status: "denied",
      response: {
        error:
          "The signed-in user is not permitted to use this tool. Say so plainly and do not guess the data.",
      },
    };
  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success)
    return {
      status: "error",
      response: {
        error: `Invalid arguments: ${parsed.error.issues[0]?.message ?? "check the schema"}`,
      },
    };
  try {
    const r = await def.run(env, parsed.data as never);
    const chart = r.chart ? ChartSchema.safeParse(r.chart) : null;
    return {
      status: "ok",
      response: sanitizeToolOutput(r.data),
      sources: sanitizeToolOutput(r.sources ?? []),
      chart: chart?.success ? chart.data : undefined,
      action: r.action,
    };
  } catch {
    return { status: "error", response: { error: "The data could not be loaded right now." } };
  }
}
