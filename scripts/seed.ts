/**
 * Demo seed: one company with 50 employees, 6 months of real payroll runs, attendance, leave,
 * expenses, policies, recognition, a survey and EWA settings. Payroll is produced by the same
 * engine the app uses, not typed in. Safe to re-run: it exits if the demo company already exists,
 * and `--reset` removes it first.
 *
 *   npm run db:seed            # DATABASE_URL must point at a migrated database with RLS applied
 *   npm run db:seed -- --reset
 */
import { and, eq, like, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, withTenant, type Tx } from "../src/lib/db";
import {
  accounts,
  announcements,
  attendanceRecords,
  departments,
  designations,
  employees,
  ewaSettings,
  expenseClaims,
  holidays,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  memberships,
  organizations,
  payments,
  payrollItems,
  payrollRuns,
  payslips,
  policyChunks,
  policyDocuments,
  recognitions,
  salaryBenchmarks,
  salaryStructures,
  shifts,
  surveyParticipation,
  surveyResponses,
  surveys,
  users,
  RECOGNITION_VALUES,
} from "../src/lib/db/schema";
import { blindIndex, encrypt } from "../src/lib/crypto";
import { computeDay, DEFAULT_SHIFT } from "../src/lib/attendance/calc";
import { classifyDay, dateRange } from "../src/lib/attendance/calendar";
import { chunkPages } from "../src/lib/policy/chunk";
import { addMonths } from "../src/lib/payroll/period";
import { createRunTx, submitRunTx } from "../src/lib/payroll/run-core";
import { assignSalaryTx } from "../src/lib/workforce/assign-salary";
import { ensureBalances, fyStartOf, seedLeaveDefaults } from "../src/lib/workforce/leave-balance";
import { lockMonthTx } from "../src/lib/workforce/lock-month";
import { seedSalaryDefaults } from "../src/lib/org-defaults";
import { responseSentiment } from "../src/lib/surveys/sentiment";
import type { ActionHelpers } from "../src/lib/action-runner";
import type { AppContext } from "../src/lib/auth/context";
import type { Role } from "../src/lib/rbac";
import { DEPARTMENTS, DESIGNATIONS, FIRST, HOLIDAYS_2026, LAST, POLICIES, rng } from "./seed-data";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* environment is already set */
  }
}

export const SEED_ORG_ID = "5eed0000-0000-4000-8000-000000000001";
const PASSWORD = "PayFlowDemo#2026";
const DEMO_USERS: { key: string; name: string; email: string; role: Role }[] = [
  { key: "admin", name: "Asha Kapoor", email: "admin@payflow.demo", role: "super_admin" },
  { key: "hr", name: "Neha Bhatt", email: "hr@payflow.demo", role: "hr_admin" },
  { key: "finance", name: "Rohit Menon", email: "finance@payflow.demo", role: "finance" },
  { key: "manager", name: "Vikram Rao", email: "manager@payflow.demo", role: "manager" },
  { key: "employee", name: "Ananya Iyer", email: "employee@payflow.demo", role: "employee" },
];

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const rupees = (n: number) => n * 100;

function helpers(tx: Tx, userId: string, role: Role): ActionHelpers {
  const ctx: AppContext = {
    user: { id: userId, name: "Seed", email: "", image: null, twoFactorEnabled: false },
    organizationId: SEED_ORG_ID,
    role,
    membershipId: "",
    employeeId: null,
    companies: [],
  };
  return {
    ctx,
    tx,
    audit: async () => {
      /* history is seeded, not audited as if a person did it */
    },
  };
}

/**
 * Paid payroll and the audit log are immutable by design (database triggers), so removing a company
 * that has them needs the table owner: the triggers are switched off inside one transaction and back
 * on before it commits. With the app's own role this fails with a clear message and changes nothing.
 */
async function reset() {
  const TRIGGERS: [string, string][] = [
    ["payroll_items", "payroll_items_lock"],
    ["audit_logs", "audit_logs_no_delete"],
  ];
  try {
    await withTenant(SEED_ORG_ID, async (tx) => {
      for (const [t, g] of TRIGGERS)
        await tx.execute(sql.raw(`alter table ${t} disable trigger ${g}`));
      await tx.delete(organizations).where(eq(organizations.id, SEED_ORG_ID));
      for (const [t, g] of TRIGGERS)
        await tx.execute(sql.raw(`alter table ${t} enable trigger ${g}`));
    });
  } catch (e) {
    throw new Error(
      "Reset needs a database role that owns the tables, because paid payroll and the audit log are protected from deletion. " +
        "Run it with DATABASE_URL set to the owner role, or drop and recreate the database. " +
        `(${e instanceof Error ? e.message : String(e)})`,
    );
  }
  await db.delete(users).where(like(users.email, "%@payflow.demo"));
  await db.delete(users).where(eq(users.id, `system-${SEED_ORG_ID}`));
}

async function main() {
  if (process.argv.includes("--reset")) {
    await reset();
    console.log("Removed the existing demo company.");
  }
  const exists = await withTenant(SEED_ORG_ID, (tx) =>
    tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, SEED_ORG_ID)),
  );
  if (exists.length) {
    console.log("Demo company already exists. Run with --reset to rebuild it.");
    return;
  }

  const rand = rng(20261104);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const today = istToday();
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 6));
  const historyStart = `${months[0]}-01`;

  // ---- logins ----
  const hash = await hashPassword(PASSWORD);
  const userIds: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const id = `seed-${u.key}`;
    userIds[u.key] = id;
    await db
      .insert(users)
      .values({ id, name: u.name, email: u.email, emailVerified: true })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({
        id: `${id}-cred`,
        accountId: id,
        providerId: "credential",
        userId: id,
        password: hash,
      })
      .onConflictDoNothing();
  }
  const extra: { id: string; name: string; email: string }[] = [];

  await withTenant(SEED_ORG_ID, async (tx) => {
    // ---- company ----
    await tx.insert(organizations).values({
      id: SEED_ORG_ID,
      name: "Brightwave Technologies",
      legalName: "Brightwave Technologies Private Limited",
      slug: "brightwave-demo",
      state: "Karnataka",
      weeklyOffs: [0, 6],
      brandColor: "#6366f1",
      onboardingCompletedAt: new Date(),
    });
    await seedSalaryDefaults(tx, SEED_ORG_ID);
    await seedLeaveDefaults(tx, SEED_ORG_ID);
    await tx.insert(shifts).values({
      organizationId: SEED_ORG_ID,
      name: "General",
      startTime: DEFAULT_SHIFT.start,
      endTime: DEFAULT_SHIFT.end,
      graceMinutes: DEFAULT_SHIFT.graceMinutes,
    });
    await tx
      .insert(holidays)
      .values(HOLIDAYS_2026.map(([date, name]) => ({ organizationId: SEED_ORG_ID, date, name })));

    const deptRows = await tx
      .insert(departments)
      .values(DEPARTMENTS.map((name) => ({ organizationId: SEED_ORG_ID, name })))
      .returning();
    const deptId = new Map(deptRows.map((d) => [d.name, d.id]));
    const desigRows = await tx
      .insert(designations)
      .values(
        DESIGNATIONS.map((d) => ({ organizationId: SEED_ORG_ID, title: d.title, level: d.level })),
      )
      .returning();
    const desigId = new Map(desigRows.map((d) => [d.title, d.id]));

    // ---- 50 employees: 5 named demo logins first, then the rest ----
    const [structure] = await tx
      .select()
      .from(salaryStructures)
      .where(eq(salaryStructures.organizationId, SEED_ORG_ID));
    const named: Record<string, { first: string; last: string; title: string }> = {
      admin: { first: "Asha", last: "Kapoor", title: "Operations Manager" },
      hr: { first: "Neha", last: "Bhatt", title: "HR Manager" },
      finance: { first: "Rohit", last: "Menon", title: "Finance Manager" },
      manager: { first: "Vikram", last: "Rao", title: "Engineering Manager" },
      employee: { first: "Ananya", last: "Iyer", title: "Software Engineer" },
    };
    const states = [
      "Karnataka",
      "Karnataka",
      "Karnataka",
      "Maharashtra",
      "Maharashtra",
      "Delhi",
      "Tamil Nadu",
      "Telangana",
    ];
    const plan: {
      code: string;
      first: string;
      last: string;
      title: string;
      email: string;
      userKey?: string;
    }[] = [];
    Object.entries(named).forEach(([k, n], i) =>
      plan.push({
        code: `BW${String(i + 1).padStart(3, "0")}`,
        first: n.first,
        last: n.last,
        title: n.title,
        email: `${k}@payflow.demo`,
        userKey: k,
      }),
    );
    const usedNames = new Set(plan.map((p) => `${p.first} ${p.last}`));
    const weights = [1, 4, 8, 5, 1, 3, 1, 4, 5, 1, 3, 1, 3, 1, 4];
    const bag = DESIGNATIONS.flatMap((d, i) => Array(weights[i]).fill(d.title) as string[]);
    while (plan.length < 50) {
      const first = pick(FIRST);
      const last = pick(LAST);
      if (usedNames.has(`${first} ${last}`)) continue;
      usedNames.add(`${first} ${last}`);
      const n = plan.length + 1;
      plan.push({
        code: `BW${String(n).padStart(3, "0")}`,
        first,
        last,
        title: pick(bag),
        email: `${first}.${last}${n}@brightwave.example`.toLowerCase(),
      });
    }

    const empIds: {
      id: string;
      code: string;
      joinDate: string;
      title: string;
      dept: string;
      userKey?: string;
    }[] = [];
    const managerOfDept = new Map<string, string>();
    for (const [i, p] of plan.entries()) {
      const d = DESIGNATIONS.find((x) => x.title === p.title)!;
      // Joined between 2022 and 2026; the last four joined during the seeded window so proration shows up.
      const join =
        i >= 46
          ? `${months[1 + (i - 46)]}-${String(3 + Math.floor(rand() * 20)).padStart(2, "0")}`
          : `${2022 + Math.floor(rand() * 4)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`;
      const pan = `${"ABCDEFGHJK"[Math.floor(rand() * 10)]}${"ABCDEFGHJK"[Math.floor(rand() * 10)]}${"ABCDEFGHJK"[Math.floor(rand() * 10)]}P${p.last[0].toUpperCase()}${String(1000 + Math.floor(rand() * 8999))}${"ABCDEFGHJK"[Math.floor(rand() * 10)]}`;
      const [row] = await tx
        .insert(employees)
        .values({
          organizationId: SEED_ORG_ID,
          userId: p.userKey ? userIds[p.userKey] : null,
          employeeCode: p.code,
          firstName: p.first,
          lastName: p.last,
          email: p.email,
          phone: `9${String(100000000 + Math.floor(rand() * 899999999))}`,
          gender: i % 5 === 1 || i % 7 === 3 ? "female" : "male",
          dateOfBirth: `${1984 + Math.floor(rand() * 18)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`,
          joinDate: join,
          probationEndDate: addMonths(join.slice(0, 7), 6) + "-01",
          status: "active",
          departmentId: deptId.get(d.dept)!,
          designationId: desigId.get(p.title)!,
          workState: states[i % states.length],
          taxRegime: i % 4 === 0 ? "old" : "new",
          panEnc: encrypt(pan),
          panIndex: blindIndex(pan),
          bankAccountEnc: encrypt(String(10_000_000_000 + Math.floor(rand() * 89_999_999_999))),
          bankIfsc: pick(["HDFC0001234", "ICIC0004321", "SBIN0005678", "UTIB0001111"]),
          bankName: pick(["HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank"]),
        } as typeof employees.$inferInsert)
        .returning({ id: employees.id });
      empIds.push({
        id: row.id,
        code: p.code,
        joinDate: join,
        title: p.title,
        dept: d.dept,
        userKey: p.userKey,
      });
      if (d.level === 5 && !managerOfDept.has(d.dept)) managerOfDept.set(d.dept, row.id);
    }
    // Each department's manager is the head; everyone else reports to them. Managers report to the Ops manager (admin).
    const topId = empIds[0].id;
    for (const e of empIds) {
      const head = managerOfDept.get(e.dept);
      const mgr = head === e.id ? (e.id === topId ? null : topId) : (head ?? topId);
      if (mgr) await tx.update(employees).set({ managerId: mgr }).where(eq(employees.id, e.id));
    }
    for (const [dept, head] of managerOfDept)
      await tx
        .update(departments)
        .set({ headEmployeeId: head })
        .where(eq(departments.id, deptId.get(dept as (typeof DEPARTMENTS)[number])!));
    for (const k of Object.keys(named)) {
      const e = empIds.find((x) => x.userKey === k)!;
      await tx.insert(memberships).values({
        organizationId: SEED_ORG_ID,
        userId: userIds[k],
        role: DEMO_USERS.find((u) => u.key === k)!.role,
        employeeId: e.id,
      });
    }

    // ---- salaries (via the real assignment code) and one mid-period increment for ~1 in 4 ----
    const hr = helpers(tx, userIds.hr, "hr_admin");
    for (const e of empIds) {
      const d = DESIGNATIONS.find((x) => x.title === e.title)!;
      const ctc = Math.round((d.ctc * (0.85 + rand() * 0.35)) / 1000) * 1000;
      const from = e.joinDate;
      await assignSalaryTx(hr, {
        employeeId: e.id,
        structureId: structure.id,
        ctcAnnual: rupees(ctc),
        effectiveFrom: from,
        reason: "Offer",
      });
      if (rand() < 0.25 && e.joinDate < `${months[2]}-01`)
        await assignSalaryTx(hr, {
          employeeId: e.id,
          structureId: structure.id,
          ctcAnnual: rupees(Math.round((ctc * 1.1) / 1000) * 1000),
          effectiveFrom: `${months[3]}-01`,
          reason: "Annual increment",
        });
    }

    // ---- leave: 2-3 approved past requests each; balances reflect them ----
    const lts = await tx
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.organizationId, SEED_ORG_ID));
    const cl = lts.find((t) => t.code === "CL")!;
    const sl = lts.find((t) => t.code === "SL")!;
    const lop = lts.find((t) => t.code === "LOP")!;
    const holidaySet = new Set(HOLIDAYS_2026.map(([d]) => d));
    const offs = [0, 6];
    const leaveDays = new Map<string, Set<string>>();
    for (const e of empIds) {
      const mine = new Set<string>();
      leaveDays.set(e.id, mine);
      const n = 2 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) {
        const t = k === 0 && rand() < 0.15 ? lop : rand() < 0.5 ? cl : sl;
        const start = dateRange(`${months[0]}-03`, addMonths(thisMonth, -1) + "-25").filter(
          (d) => classifyDay(d, offs, holidaySet) === "working" && d >= e.joinDate,
        );
        if (!start.length) continue;
        const from = start[Math.floor(rand() * start.length)];
        const len = rand() < 0.7 ? 1 : 2;
        const days = dateRange(from, addMonths(from.slice(0, 7), 1) + "-28")
          .filter((d) => classifyDay(d, offs, holidaySet) === "working")
          .slice(0, len);
        if (days.some((d) => mine.has(d))) continue;
        days.forEach((d) => mine.add(d));
        await tx.insert(leaveRequests).values({
          organizationId: SEED_ORG_ID,
          employeeId: e.id,
          leaveTypeId: t.id,
          fromDate: days[0],
          toDate: days[days.length - 1],
          days: String(days.length),
          halfDay: false,
          reason: "Personal",
          status: "approved",
          decidedBy: userIds.hr,
          decidedAt: new Date(),
        });
      }
      await ensureBalances(tx, SEED_ORG_ID, { id: e.id, joinDate: e.joinDate }, fyStartOf(today));
    }
    const approved = await tx
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.organizationId, SEED_ORG_ID));
    for (const r of approved) {
      const bal = await tx
        .select()
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.employeeId, r.employeeId),
            eq(leaveBalances.leaveTypeId, r.leaveTypeId),
            eq(leaveBalances.fyStart, fyStartOf(today)),
          ),
        );
      if (bal[0] && r.leaveTypeId !== lop.id)
        await tx
          .update(leaveBalances)
          .set({ used: String(Number(bal[0].used) + Number(r.days)) })
          .where(eq(leaveBalances.id, bal[0].id));
    }
    // a few pending requests for the current month so approvals are not empty
    for (const e of empIds.slice(5, 9)) {
      const d = dateRange(
        `${thisMonth}-${String(Math.min(28, Number(today.slice(8)) + 3)).padStart(2, "0")}`,
        `${thisMonth}-28`,
      ).find((x) => classifyDay(x, offs, holidaySet) === "working");
      if (d)
        await tx.insert(leaveRequests).values({
          organizationId: SEED_ORG_ID,
          employeeId: e.id,
          leaveTypeId: cl.id,
          fromDate: d,
          toDate: d,
          days: "1",
          reason: "Family function",
          status: "pending",
        });
    }

    // ---- attendance for the whole window ----
    const rows: (typeof attendanceRecords.$inferInsert)[] = [];
    const ist = (date: string, mins: number) =>
      new Date(Date.parse(`${date}T00:00:00Z`) + mins * 60_000 - 5.5 * 3600_000);
    for (const e of empIds) {
      for (const date of dateRange(historyStart, today)) {
        if (date < e.joinDate || classifyDay(date, offs, holidaySet) !== "working") continue;
        if (leaveDays.get(e.id)?.has(date)) {
          rows.push({
            organizationId: SEED_ORG_ID,
            employeeId: e.id,
            date,
            status: "leave",
            source: "leave",
          });
          continue;
        }
        const roll = rand();
        if (date === today && roll < 0.3) continue; // some have not checked in yet today
        if (roll > 0.985) {
          rows.push({
            organizationId: SEED_ORG_ID,
            employeeId: e.id,
            date,
            status: "absent",
            source: "manual",
          });
          continue;
        }
        const inMin = 9 * 60 + 20 + Math.floor(rand() * (roll < 0.12 ? 70 : 30));
        const worked = roll > 0.97 ? 4.5 * 60 : 8 * 60 + 40 + Math.floor(rand() * 90) - 30;
        const cin = ist(date, inMin);
        const cout = date === today ? null : ist(date, inMin + worked);
        const day = computeDay(cin, cout, DEFAULT_SHIFT, "Asia/Kolkata");
        rows.push({
          organizationId: SEED_ORG_ID,
          employeeId: e.id,
          date,
          status: day.status,
          checkIn: cin,
          checkOut: cout,
          workedMinutes: day.workedMinutes,
          lateMinutes: day.lateMinutes,
          overtimeMinutes: day.overtimeMinutes,
          source: "self",
        });
      }
    }
    for (let i = 0; i < rows.length; i += 1000)
      await tx.insert(attendanceRecords).values(rows.slice(i, i + 1000));

    // ---- six months of payroll through the real engine ----
    const finance = helpers(tx, userIds.finance, "finance");
    const categories = ["Travel", "Meals", "Internet", "Client entertainment", "Training"];
    for (const month of months) {
      for (const e of empIds.filter((x) => x.joinDate.slice(0, 7) <= month).slice(8, 20)) {
        if (rand() < 0.4)
          await tx.insert(expenseClaims).values({
            organizationId: SEED_ORG_ID,
            employeeId: e.id,
            category: pick(categories),
            description: "Business expense",
            amount: rupees(500 + Math.floor(rand() * 6000)),
            expenseDate: `${month}-1${Math.floor(rand() * 9)}`,
            status: "approved",
            decidedBy: userIds.manager,
            decidedAt: new Date(),
          });
      }
      await lockMonthTx(hr, month);
      const { id: runId } = await createRunTx(hr, month);
      await submitRunTx(hr, runId);
      await tx
        .update(payrollRuns)
        .set({ status: "approved", approvedBy: userIds.finance, approvedAt: new Date() })
        .where(eq(payrollRuns.id, runId));
      const items = await tx.select().from(payrollItems).where(eq(payrollItems.runId, runId));
      const codeOf = new Map(empIds.map((e) => [e.id, e.code]));
      await tx.insert(payslips).values(
        items.map((i) => ({
          organizationId: SEED_ORG_ID,
          runId,
          employeeId: i.employeeId,
          itemId: i.id,
          month,
          number: `PS-${month.replace("-", "")}-${codeOf.get(i.employeeId)}`,
        })),
      );
      const payable = items.filter((i) => (i.net ?? 0) > 0 && !i.onHold);
      await tx.insert(payments).values(
        payable.map((i) => ({
          organizationId: SEED_ORG_ID,
          runId,
          employeeId: i.employeeId,
          amount: i.net,
          idempotencyKey: `${runId}:${i.employeeId}`,
          status: "processed" as const,
          providerRef: `sim_${runId.slice(0, 8)}_${i.employeeId.slice(0, 6)}`,
          processedAt: new Date(),
          attempts: 1,
        })),
      );
      for (const i of items.filter((x) => x.expenseAmount > 0))
        await tx
          .update(expenseClaims)
          .set({ status: "paid", runId })
          .where(
            and(eq(expenseClaims.employeeId, i.employeeId), eq(expenseClaims.status, "approved")),
          );
      await tx
        .update(payrollRuns)
        .set({ status: "paid", processedBy: userIds.finance, processedAt: new Date() })
        .where(eq(payrollRuns.id, runId));
      void finance;
    }
    // pending expense claims now, so the approval queue has something real
    for (const e of empIds.slice(10, 14))
      await tx.insert(expenseClaims).values({
        organizationId: SEED_ORG_ID,
        employeeId: e.id,
        category: pick(categories),
        description: "Client visit",
        amount: rupees(1200 + Math.floor(rand() * 3000)),
        expenseDate: `${thisMonth}-0${1 + Math.floor(rand() * 3)}`,
        status: "submitted",
      });

    // ---- policies (keyword-searchable; no embeddings are fabricated) ----
    for (const p of POLICIES) {
      const chunks = chunkPages(p.pages);
      const [doc] = await tx
        .insert(policyDocuments)
        .values({
          organizationId: SEED_ORG_ID,
          title: p.title,
          filename: p.filename,
          pages: p.pages.length,
          chunkCount: chunks.length,
          indexMode: "keyword",
          uploadedBy: userIds.hr,
        })
        .returning({ id: policyDocuments.id });
      await tx.insert(policyChunks).values(
        chunks.map((c) => ({
          organizationId: SEED_ORG_ID,
          documentId: doc.id,
          idx: c.idx,
          page: c.page,
          content: c.content,
        })),
      );
    }
    await tx.insert(announcements).values([
      {
        organizationId: SEED_ORG_ID,
        title: "Diwali holiday on 8 November",
        body: "The office is closed on Sunday 8 November for Diwali. Wishing everyone a safe and bright festival.",
        pinned: true,
        createdBy: userIds.hr,
      },
      {
        organizationId: SEED_ORG_ID,
        title: "Tax declarations open",
        body: "Submit your investment declarations in PayFlow before 15 December so TDS is calculated correctly.",
        createdBy: userIds.hr,
      },
    ]);

    // ---- engagement, EWA, benchmarks, survey ----
    await tx
      .insert(ewaSettings)
      .values({ organizationId: SEED_ORG_ID, enabled: true } as typeof ewaSettings.$inferInsert)
      .onConflictDoNothing();
    for (let i = 0; i < 18; i++) {
      const from = empIds[Math.floor(rand() * empIds.length)];
      let to = empIds[Math.floor(rand() * empIds.length)];
      if (to.id === from.id) to = empIds[(empIds.indexOf(to) + 1) % empIds.length];
      await tx.insert(recognitions).values({
        organizationId: SEED_ORG_ID,
        fromEmployeeId: from.id,
        toEmployeeId: to.id,
        value: pick(RECOGNITION_VALUES),
        message: pick([
          "Stayed late to help us ship on time.",
          "Great teamwork on the client launch.",
          "Thanks for patiently walking me through the process.",
          "Took ownership when it mattered.",
        ]),
      });
    }
    for (const d of DESIGNATIONS.filter((x) => x.level <= 5)) {
      const base = rupees(d.ctc);
      await tx.insert(salaryBenchmarks).values({
        organizationId: SEED_ORG_ID,
        designationId: desigId.get(d.title)!,
        p25: Math.round(base * 0.85),
        p50: base,
        p75: Math.round(base * 1.2),
        source: "Demo data entered by seed script",
        asOf: today,
      });
    }
    const [sv] = await tx
      .insert(surveys)
      .values({
        organizationId: SEED_ORG_ID,
        title: "Quarterly pulse",
        description: "Three quick questions. Your answers are anonymous.",
        byDepartment: true,
        createdBy: userIds.hr,
        questions: [
          { id: "q1", text: "I would recommend this company as a place to work.", kind: "scale" },
          {
            id: "q2",
            text: "I have the tools and support I need to do my job well.",
            kind: "scale",
          },
          { id: "q3", text: "What one thing should we change?", kind: "text" },
        ],
      })
      .returning({ id: surveys.id });
    const comments = [
      "Better onboarding documents please.",
      "I love the flexible hours.",
      "Too many meetings, hard to focus.",
      "Great manager and supportive team.",
      "Slow laptop approvals are frustrating.",
    ];
    const answered = empIds.filter((e) => e.userKey !== "employee").slice(0, 22);
    for (const e of answered) {
      const q1 = 2 + Math.floor(rand() * 4);
      const q2 = 2 + Math.floor(rand() * 4);
      const c = pick(comments);
      const s = responseSentiment([q1, q2], c);
      const deptOf = deptId.get(DESIGNATIONS.find((x) => x.title === e.title)!.dept)!;
      await tx.insert(surveyResponses).values({
        organizationId: SEED_ORG_ID,
        surveyId: sv.id,
        departmentId: deptOf,
        answers: { q1, q2, q3: c },
        sentiment: s.sentiment,
        sentimentScore: s.score,
        submittedOn: today,
      });
      const uid = e.userKey ? userIds[e.userKey] : null;
      if (uid)
        await tx
          .insert(surveyParticipation)
          .values({ organizationId: SEED_ORG_ID, surveyId: sv.id, userId: uid });
    }
    void extra;
  });

  console.log(
    `Seeded "Brightwave Technologies": 50 employees, ${months.length} paid payroll runs (${months[0]} to ${months[5]}).`,
  );
  console.log(`Sign in with any of: ${DEMO_USERS.map((u) => u.email).join(", ")}`);
  console.log(`Password for all: ${PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
