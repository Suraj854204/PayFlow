import "server-only";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  announcements,
  employees,
  leaveBalances,
  leaveTypes,
  payrollItems,
  payrollRuns,
  payslips,
  taxDeclarations,
} from "@/lib/db/schema";
import { professionalTax } from "@/lib/payroll/pt";
import { computePf, pfCeiling } from "@/lib/payroll/statutory";
import { NO_DECLARATIONS, SECTION_80D_CAP, compareRegimes, hraExemption } from "@/lib/payroll/tax";
import { fyStartYear } from "@/lib/payroll/period";
import { salaryAt } from "@/lib/payroll/service";
import { computeBreakdownSafe } from "@/lib/tax-view";
import { ensureBalances } from "@/lib/workforce/leave-balance";
import { taxTips, type Tip } from "./tips";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  at: string;
}

/** Announcements that have not expired, pinned first, newest first. Shared by every role. */
export async function loadAnnouncements(
  tx: Tx,
  organizationId: string,
  today: string,
  limit = 5,
): Promise<AnnouncementRow[]> {
  const rows = await tx
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        or(isNull(announcements.expiresOn), gt(announcements.expiresOn, today)),
      ),
    )
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
    .limit(limit);
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    at: a.createdAt.toISOString(),
  }));
}

export interface EmployeeDashboard {
  latest: { month: string; net: number; gross: number; payslipId: string | null } | null;
  history: { month: string; net: number; payslipId: string | null }[];
  leave: { code: string; name: string; left: number; allotted: number }[];
  tax: {
    regime: "old" | "new";
    status: string;
    ytdTds: number;
    annualTax: number | null;
    betterRegime: "old" | "new" | null;
    saving: number;
  };
  tips: Tip[];
}

/** The signed-in employee's own pay, leave and tax picture. Nothing about anyone else. */
export async function loadEmployeeDashboard(
  tx: Tx,
  organizationId: string,
  employeeId: string,
  today: string,
): Promise<EmployeeDashboard> {
  const month = today.slice(0, 7);
  const fy = fyStartYear(month);
  const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId));

  const rows = await tx
    .select({
      month: payrollRuns.month,
      net: payrollItems.net,
      gross: payrollItems.gross,
      deductions: payrollItems.deductions,
      slip: payslips.id,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .leftJoin(payslips, eq(payslips.itemId, payrollItems.id))
    .where(
      and(
        eq(payrollItems.employeeId, employeeId),
        eq(payrollItems.onHold, false),
        or(
          eq(payrollRuns.status, "approved"),
          eq(payrollRuns.status, "processing"),
          eq(payrollRuns.status, "paid"),
        ),
      ),
    )
    .orderBy(desc(payrollRuns.month))
    .limit(12);
  const history = rows
    .slice(0, 6)
    .reverse()
    .map((r) => ({ month: r.month, net: r.net, payslipId: r.slip }));
  const latest = rows[0]
    ? { month: rows[0].month, net: rows[0].net, gross: rows[0].gross, payslipId: rows[0].slip }
    : null;
  const ytdTds = rows
    .filter((r) => fyStartYear(r.month) === fy)
    .reduce((s, r) => s + (r.deductions.find((d) => d.code === "TDS")?.amount ?? 0), 0);

  if (emp) await ensureBalances(tx, organizationId, { id: emp.id, joinDate: emp.joinDate }, fy);
  const bal = await tx
    .select({ b: leaveBalances, t: leaveTypes })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.fyStart, fy)));
  const leave = bal
    .filter(({ t }) => t.isPaid)
    .map(({ b, t }) => ({
      code: t.code,
      name: t.name,
      allotted: Number(b.allotted),
      left: Math.round((Number(b.allotted) - Number(b.used)) * 10) / 10,
    }));

  const [decl] = await tx
    .select()
    .from(taxDeclarations)
    .where(and(eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fyStart, fy)));
  const regime: "old" | "new" = decl?.regime === "old" ? "old" : "new";
  const data = decl?.data;

  let annualTax: number | null = null;
  let compare: ReturnType<typeof compareRegimes> | null = null;
  let pfAnnual = 0;
  let hraAnnual = 0;
  const sal = emp ? await salaryAt(tx, organizationId, emp.id, month) : null;
  if (emp && sal) {
    const v = computeBreakdownSafe(sal.breakdown);
    hraAnnual = v.hra * 12;
    const hra = hraExemption({
      basicAnnual: v.basic * 12,
      hraAnnual,
      rentAnnual: data?.annualRent ?? 0,
      metro: data?.metro ?? false,
    });
    pfAnnual = computePf(v.pfWages, pfCeiling(month)).employee * 12;
    let pt = 0;
    for (let m = 1; m <= 12; m++) pt += professionalTax(emp.workState, v.gross, m, emp.gender).tax;
    compare = compareRegimes(v.taxable * 12, pfAnnual, pt, {
      ...NO_DECLARATIONS,
      section80C: data?.section80C ?? 0,
      section80D: Math.min(data?.section80D ?? 0, SECTION_80D_CAP),
      otherDeductions: data?.otherDeductions ?? 0,
      hraExemption: hra,
    });
    annualTax = regime === "old" ? compare.oldTax : compare.newTax;
  }

  const status = decl?.status ?? "none";
  const tips = taxTips({
    regime,
    declarationStatus: status,
    section80C: data?.section80C ?? 0,
    section80D: data?.section80D ?? 0,
    annualRent: data?.annualRent ?? 0,
    employeePfAnnual: pfAnnual,
    hraAnnual,
    compare: compare ? { better: compare.better, saving: compare.saving } : null,
  });

  return {
    latest,
    history,
    leave,
    tax: {
      regime,
      status,
      ytdTds,
      annualTax,
      betterRegime: compare?.better ?? null,
      saving: compare?.saving ?? 0,
    },
    tips,
  };
}
