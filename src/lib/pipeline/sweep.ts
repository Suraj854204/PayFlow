import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action";
import type { ActionHelpers } from "@/lib/action-runner";
import type { AppContext } from "@/lib/auth/context";
import { db, withTenant, type Tx } from "@/lib/db";
import {
  attendanceLocks,
  complianceItems,
  employees,
  memberships,
  payrollPipelines,
  payrollRuns,
  pipelineSteps,
  users,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { analyzeRun } from "@/lib/anomaly/load";
import { ensureCalendar } from "@/lib/compliance/reminders";
import { KIND_LABEL, type ComplianceKind } from "@/lib/compliance/calendar";
import { notify } from "@/lib/notify";
import { addMonths } from "@/lib/payroll/period";
import { createRunTx, submitRunTx } from "@/lib/payroll/run-core";
import { can, type Role } from "@/lib/rbac";
import { lockMonthTx } from "@/lib/workforce/lock-month";
import { emitEvent } from "@/lib/workflow/dispatch";

import type { StepName } from "./labels";

const istNow = () => new Date(Date.now() + 5.5 * 3600_000);

/** Automation acts as a per-company system user so the maker-checker rule still needs a human approver. */
export async function ensureSystemUser(orgId: string) {
  const id = `system-${orgId}`;
  await db
    .insert(users)
    .values({
      id,
      name: "PayFlow Automation",
      email: `system+${orgId}@payflow.invalid`,
      emailVerified: true,
    })
    .onConflictDoNothing();
  return id;
}

function systemHelpers(orgId: string, tx: Tx, userId: string): ActionHelpers {
  const ctx: AppContext = {
    user: {
      id: userId,
      name: "PayFlow Automation",
      email: "",
      image: null,
      twoFactorEnabled: false,
    },
    organizationId: orgId,
    role: "hr_admin",
    membershipId: "",
    employeeId: null,
    companies: [],
  };
  return {
    ctx,
    tx,
    audit: async (entry) => {
      await writeAudit(tx, {
        ...entry,
        organizationId: orgId,
        actorUserId: userId,
        actorRole: "system",
      });
    },
  };
}

async function record(
  orgId: string,
  month: string,
  step: StepName,
  status: "done" | "blocked" | "skipped" | "failed",
  detail: string,
  count = 1,
) {
  await withTenant(orgId, (tx) =>
    tx
      .insert(pipelineSteps)
      .values({ organizationId: orgId, month, step, status, detail, count })
      .onConflictDoUpdate({
        target: [pipelineSteps.organizationId, pipelineSteps.month, pipelineSteps.step],
        set: { status, detail, count, updatedAt: new Date() },
      }),
  );
}

async function notifyRoles(
  tx: Tx,
  orgId: string,
  roles: Role[],
  title: string,
  body: string,
  href: string,
) {
  const people = await tx
    .select({ u: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, orgId),
        eq(memberships.isActive, true),
        inArray(memberships.role, roles),
      ),
    );
  for (const p of people)
    await notify(tx, orgId, { userId: p.u, type: "pipeline", title, body, href });
}

const APPROVER_ROLES = (["super_admin", "hr_admin", "finance"] as Role[]).filter((r) =>
  can(r, "payroll:approve"),
);

/**
 * Advances one company's pipeline for `month` as far as it safely can. Each step is recorded once,
 * so running it every few minutes never repeats work. It stops (and says why) on anything a person
 * should look at. Approval and payment always stay with people.
 */
export async function advancePipeline(
  orgId: string,
  month: string,
): Promise<StepName | "complete"> {
  const done = new Map(
    (
      await withTenant(orgId, (tx) =>
        tx
          .select()
          .from(pipelineSteps)
          .where(and(eq(pipelineSteps.organizationId, orgId), eq(pipelineSteps.month, month))),
      )
    ).map((s) => [s.step, s]),
  );
  const isDone = (s: StepName) =>
    done.get(s)?.status === "done" || done.get(s)?.status === "skipped";
  const systemId = await ensureSystemUser(orgId);

  // 1. Lock attendance
  if (!isDone("lock")) {
    try {
      await withTenant(orgId, async (tx) => {
        const [already] = await tx
          .select({ id: attendanceLocks.id })
          .from(attendanceLocks)
          .where(and(eq(attendanceLocks.organizationId, orgId), eq(attendanceLocks.month, month)));
        if (!already) await lockMonthTx(systemHelpers(orgId, tx, systemId), month);
      });
      await record(orgId, month, "lock", "done", "Attendance locked for the month");
    } catch (e) {
      await record(
        orgId,
        month,
        "lock",
        "failed",
        e instanceof Error ? e.message : "Could not lock attendance",
      );
      return "lock";
    }
  }

  // 2. Draft payroll
  let runId: string | undefined;
  if (!isDone("draft")) {
    try {
      runId = await withTenant(orgId, async (tx) => {
        const [existing] = await tx
          .select({ id: payrollRuns.id })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.organizationId, orgId),
              eq(payrollRuns.month, month),
              sql`${payrollRuns.status} <> 'cancelled'`,
            ),
          );
        if (existing) return existing.id;
        return (await createRunTx(systemHelpers(orgId, tx, systemId), month)).id;
      });
      await record(orgId, month, "draft", "done", "Draft payroll is ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create the draft";
      const blocked = e instanceof UserFacingError;
      await record(orgId, month, "draft", blocked ? "blocked" : "failed", msg);
      if (!done.has("draft") || done.get("draft")?.detail !== msg)
        await withTenant(orgId, (tx) =>
          notifyRoles(
            tx,
            orgId,
            ["super_admin", "hr_admin"],
            "Automatic payroll needs you",
            msg,
            "/payroll",
          ),
        );
      return "draft";
    }
  }
  runId ??= (
    await withTenant(orgId, (tx) =>
      tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.organizationId, orgId),
            eq(payrollRuns.month, month),
            sql`${payrollRuns.status} <> 'cancelled'`,
          ),
        )
        .limit(1),
    )
  )[0]?.id;
  if (!runId) return "draft";

  const status = (
    await withTenant(orgId, (tx) =>
      tx
        .select({ s: payrollRuns.status, at: payrollRuns.submittedAt })
        .from(payrollRuns)
        .where(eq(payrollRuns.id, runId!)),
    )
  )[0];

  // 3. Check for problems (only while it is still a draft)
  if (!isDone("checks") && status?.s === "draft") {
    const problems = await withTenant(orgId, async (tx) => {
      const a = await analyzeRun(tx, orgId, runId!, istNow().toISOString().slice(0, 10));
      if (!a) return ["Run not found"];
      const out: string[] = [];
      for (const c of a.checks.filter((c) => c.status === "fail")) out.push(c.title);
      const high = a.anomalies.filter((x) => x.severity === "high");
      if (high.length)
        out.push(`${high.length} high-severity anomal${high.length === 1 ? "y" : "ies"}`);
      return out;
    });
    if (problems.length) {
      const detail = `Held for review: ${problems.join("; ")}`;
      const prev = done.get("checks");
      await record(orgId, month, "checks", "blocked", detail, problems.length);
      if (prev?.detail !== detail)
        await withTenant(orgId, (tx) =>
          notifyRoles(
            tx,
            orgId,
            ["super_admin", "hr_admin", "finance"],
            "Payroll held for review",
            detail,
            `/payroll/${runId}`,
          ),
        );
      return "checks";
    }
    await record(orgId, month, "checks", "done", "No blocking problems found");
  } else if (!isDone("checks")) {
    await record(orgId, month, "checks", "skipped", "Run was already past draft");
  }

  // 4. Submit for approval
  if (!isDone("submit")) {
    if (status?.s === "draft") {
      try {
        await withTenant(orgId, async (tx) => {
          await submitRunTx(systemHelpers(orgId, tx, systemId), runId!);
          await notifyRoles(
            tx,
            orgId,
            APPROVER_ROLES,
            "Payroll is ready for approval",
            `The ${month} run was prepared automatically and checked.`,
            `/payroll/${runId}`,
          );
        });
        await record(orgId, month, "submit", "done", "Submitted for approval");
      } catch (e) {
        await record(
          orgId,
          month,
          "submit",
          "blocked",
          e instanceof Error ? e.message : "Could not submit",
        );
        return "submit";
      }
    } else {
      await record(orgId, month, "submit", "skipped", `Run is already ${status?.s}`);
    }
  }

  // 5. Remind approvers once, if it has been waiting longer than reminderHours
  const [cfg] = await withTenant(orgId, (tx) =>
    tx.select().from(payrollPipelines).where(eq(payrollPipelines.organizationId, orgId)),
  );
  const fresh = (
    await withTenant(orgId, (tx) =>
      tx
        .select({ s: payrollRuns.status, at: payrollRuns.submittedAt })
        .from(payrollRuns)
        .where(eq(payrollRuns.id, runId!)),
    )
  )[0];
  if (!isDone("remind")) {
    if (fresh?.s === "review") {
      const waitedMs = Date.now() - (fresh.at?.getTime() ?? Date.now());
      if (waitedMs >= (cfg?.reminderHours ?? 24) * 3600_000) {
        await withTenant(orgId, (tx) =>
          notifyRoles(
            tx,
            orgId,
            APPROVER_ROLES,
            "Reminder: payroll is waiting for approval",
            `The ${month} run has been waiting ${Math.floor(waitedMs / 3600_000)} hours.`,
            `/payroll/${runId}`,
          ),
        );
        await record(orgId, month, "remind", "done", "Approvers reminded");
      } else return "remind";
    } else if (fresh && fresh.s !== "draft") {
      await record(orgId, month, "remind", "skipped", "No reminder needed");
    } else return "remind";
  }

  // 6. Tell employees once the run has been processed (approval alone does not pay anyone)
  if (!isDone("payslips")) {
    if (fresh && ["processing", "paid"].includes(fresh.s)) {
      const n = await withTenant(orgId, async (tx) => {
        const emps = await tx
          .select({ userId: employees.userId })
          .from(employees)
          .where(eq(employees.organizationId, orgId));
        let c = 0;
        for (const e of emps)
          if (e.userId) {
            await notify(tx, orgId, {
              userId: e.userId,
              type: "payslip",
              title: `Your ${month} payslip is ready`,
              href: "/payslips",
            });
            c++;
          }
        return c;
      });
      await record(orgId, month, "payslips", "done", `Notified ${n} employee(s)`, n);
    } else return "payslips";
  }
  return "complete";
}

/** Daily-ish sweep for every company: advance enabled pipelines and raise deadline events. */
export async function runPipelineSweep(): Promise<{ pipelines: number; deadlines: number }> {
  const ist = istNow();
  const today = ist.toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const orgs = (await db.execute(sql`select automation_org_ids() as id`)).rows as { id: string }[];
  let pipelines = 0;
  let deadlines = 0;
  for (const { id: orgId } of orgs) {
    try {
      const [cfg] = await withTenant(orgId, (tx) =>
        tx.select().from(payrollPipelines).where(eq(payrollPipelines.organizationId, orgId)),
      );
      if (cfg?.enabled && ist.getUTCDate() >= cfg.startDay) {
        await advancePipeline(orgId, addMonths(thisMonth, -1));
        pipelines++;
      }
      deadlines += await raiseDeadlineEvents(orgId, today);
    } catch (e) {
      console.error("[pipeline]", orgId, e);
    }
  }
  return { pipelines, deadlines };
}

/** Emits `deadline.near` once per compliance item when it is due within 3 days (or overdue). */
export async function raiseDeadlineEvents(orgId: string, today: string): Promise<number> {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const items = await withTenant(orgId, async (tx) => {
    await ensureCalendar(tx, orgId, today.slice(0, 7));
    return tx
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.organizationId, orgId),
          eq(complianceItems.status, "pending"),
          lte(complianceItems.dueDate, soon),
        ),
      );
  });
  for (const it of items) {
    const daysLeft = Math.round(
      (Date.parse(`${it.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    await emitEvent(
      orgId,
      "deadline.near",
      {
        deadline: {
          label: `${KIND_LABEL[it.kind as ComplianceKind] ?? it.kind} for ${it.period}`,
          kind: it.kind,
          period: it.period,
          dueDate: it.dueDate,
          daysLeft,
        },
      },
      `deadline:${it.id}`,
    );
  }
  return items.length;
}
