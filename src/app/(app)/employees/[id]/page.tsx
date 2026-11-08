import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChecklistPanel,
  DocumentsPanel,
  EmployeeActions,
  RevealSensitive,
  SalaryPanel,
} from "@/components/employees/employee-panels";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { getEmployeeDetail, getEmployeeExtras, getSalaryLibrary } from "@/lib/queries";
import {
  departments,
  designations,
  employees,
  loanRepayments,
  loans,
  settlements,
} from "@/lib/db/schema";
import { LoansPanel, SettlementPanel } from "@/components/employees/payroll-panel";
import { desc, eq, sql } from "drizzle-orm";
import { can } from "@/lib/rbac";
import { initials } from "@/lib/utils";

export const metadata = { title: "Employee" };

const fmt = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("employees:read");
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) notFound();
  const canWrite = can(ctx.role, "employees:write");
  const canSalary = can(ctx.role, "salary:read");
  const canPayroll = can(ctx.role, "payroll:read");

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const e = await getEmployeeDetail(tx, ctx.organizationId, id.data);
    if (!e) return null;
    const [extras, lib, dept, desig, mgr] = await Promise.all([
      getEmployeeExtras(tx, ctx.organizationId, e.id, canSalary),
      canSalary
        ? getSalaryLibrary(tx, ctx.organizationId)
        : Promise.resolve({ components: [], structures: [] }),
      e.departmentId
        ? tx
            .select({ n: departments.name })
            .from(departments)
            .where(eq(departments.id, e.departmentId))
        : Promise.resolve([]),
      e.designationId
        ? tx
            .select({ n: designations.title })
            .from(designations)
            .where(eq(designations.id, e.designationId))
        : Promise.resolve([]),
      e.managerId
        ? tx
            .select({ f: employees.firstName, l: employees.lastName })
            .from(employees)
            .where(eq(employees.id, e.managerId))
        : Promise.resolve([]),
    ]);
    const loanRows = canPayroll
      ? await tx
          .select({
            l: loans,
            n: sql<number>`(select count(*)::int from ${loanRepayments} r where r.loan_id = ${loans.id})`,
          })
          .from(loans)
          .where(eq(loans.employeeId, e.id))
          .orderBy(desc(loans.createdAt))
      : [];
    const [settlement] = canPayroll
      ? await tx.select().from(settlements).where(eq(settlements.employeeId, e.id))
      : [];
    return {
      loanRows,
      settlement,
      e,
      extras,
      lib,
      dept: dept[0]?.n,
      desig: desig[0]?.n,
      mgr: mgr[0] ? `${mgr[0].f} ${mgr[0].l}`.trim() : undefined,
    };
  });
  if (!data) notFound();
  const { e, extras } = data;
  const today = new Date().toISOString().slice(0, 10);

  const rows: [string, string][] = [
    ["Email", e.email],
    ["Phone", e.phone ?? "—"],
    ["Department", data.dept ?? "—"],
    ["Designation", data.desig ?? "—"],
    ["Reports to", data.mgr ?? "—"],
    ["Type", e.employmentType.replace("_", " ")],
    ["Joined", fmt(e.joinDate)],
    ["Probation ends", fmt(e.probationEndDate)],
    ["Work state", e.workState ?? "—"],
    ["Tax regime", e.taxRegime === "old" ? "Old regime" : "New regime"],
    ["PAN", e.panMasked ?? "—"],
    ["Aadhaar", e.aadhaarMasked ?? "—"],
    ["Bank account", e.bankAccountMasked ?? "—"],
    ["IFSC", e.bankIfsc ?? "—"],
    ["UAN", e.uan ?? "—"],
  ];
  if (e.exitDate)
    rows.push(["Last working day", fmt(e.exitDate)], ["Exit reason", e.exitReason ?? "—"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="bg-accent text-accent-foreground grid size-14 place-items-center rounded-full text-lg font-semibold">
            {initials(`${e.firstName} ${e.lastName}`)}
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {e.firstName} {e.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">
              {e.employeeCode} ·{" "}
              <Badge
                tone={
                  e.status === "active"
                    ? "success"
                    : e.status === "probation"
                      ? "warning"
                      : e.status === "notice"
                        ? "danger"
                        : "neutral"
                }
              >
                {e.status}
              </Badge>
            </p>
          </div>
        </div>
        {canWrite && (
          <Button variant="outline" asChild>
            <Link href={`/employees/${e.id}/edit`}>
              <Pencil /> Edit
            </Link>
          </Button>
        )}
      </div>

      {canWrite && (
        <EmployeeActions
          employeeId={e.id}
          email={e.email}
          status={e.status}
          canInvite={can(ctx.role, "members:manage")}
          linked={Boolean(e.userId)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground text-xs">{k}</dt>
                  <dd className="text-sm break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {canWrite && (
              <div className="mt-4">
                <RevealSensitive employeeId={e.id} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Checklists</CardTitle>
          </CardHeader>
          <CardContent>
            <ChecklistPanel
              canEdit={canWrite}
              items={extras.checklist.map((c) => ({
                id: c.id,
                kind: c.kind,
                title: c.title,
                doneAt: c.doneAt ? c.doneAt.toISOString() : null,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {canSalary && (
        <Card>
          <CardHeader>
            <CardTitle>Salary</CardTitle>
          </CardHeader>
          <CardContent>
            <SalaryPanel
              employeeId={e.id}
              today={today}
              canEdit={can(ctx.role, "salary:write")}
              structures={data.lib.structures.map((s) => ({ id: s.id, name: s.name }))}
              history={extras.salaries.map((s) => ({
                id: s.id,
                ctcAnnual: s.ctcAnnual,
                effectiveFrom: s.effectiveFrom,
                reason: s.reason,
                monthlyGross: s.breakdown
                  .filter((l) => l.type === "earning")
                  .reduce((a, l) => a + l.monthly, 0),
                lines: s.breakdown.map((l) => ({
                  code: l.code,
                  name: l.name,
                  type: l.type,
                  monthly: l.monthly,
                })),
              }))}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentsPanel employeeId={e.id} canEdit={canWrite} docs={extras.docs} />
        </CardContent>
      </Card>

      {canPayroll && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Loans and advances</CardTitle>
            </CardHeader>
            <CardContent>
              <LoansPanel
                employeeId={e.id}
                canEdit={can(ctx.role, "payroll:create")}
                defaultMonth={today.slice(0, 7)}
                loans={data.loanRows.map(({ l, n }) => ({
                  id: l.id,
                  kind: l.kind,
                  principal: l.principal,
                  emi: l.emi,
                  balance: l.balance,
                  startMonth: l.startMonth,
                  status: l.status,
                  repayments: Number(n),
                }))}
              />
            </CardContent>
          </Card>
          {e.status !== "exited" || data.settlement ? (
            <Card>
              <CardHeader>
                <CardTitle>Full and final settlement</CardTitle>
              </CardHeader>
              <CardContent>
                <SettlementPanel
                  employeeId={e.id}
                  today={today}
                  canPrepare={can(ctx.role, "payroll:create")}
                  canApprove={can(ctx.role, "payroll:approve")}
                  canPay={can(ctx.role, "payroll:process")}
                  settlement={
                    data.settlement
                      ? {
                          id: data.settlement.id,
                          status: data.settlement.status,
                          payable: data.settlement.payable,
                          lastWorkingDay: data.settlement.lastWorkingDay,
                          lines: data.settlement.lines,
                          createdByMe: data.settlement.createdBy === ctx.user.id,
                        }
                      : null
                  }
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
