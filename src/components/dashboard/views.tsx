import Link from "next/link";
import {
  CalendarCheck,
  Download,
  FileText,
  Landmark,
  Plane,
  Receipt,
  Rocket,
  UserPlus,
  BarChart3,
} from "lucide-react";
import { AreaChart } from "@/components/charts/area-chart";
import { Donut } from "@/components/charts/donut";
import { Announcements } from "@/components/dashboard/announcements";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  ActivityFeed,
  CountdownCard,
  InsightsPanel,
  QuickActions,
} from "@/components/dashboard/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Item, Stagger } from "@/components/ui/reveal";
import type { AdminDashboard } from "@/lib/dashboard/load-admin";
import type { AnnouncementRow, EmployeeDashboard } from "@/lib/dashboard/load-employee";
import type { TeamDashboard, TeamStatus } from "@/lib/dashboard/load-team";
import { formatINR } from "@/lib/money";
import { monthLabel } from "@/lib/payroll/period";
import { can, type Role } from "@/lib/rbac";

const short = (m: string) => monthLabel(m).replace(/\s\d{4}$/, " ’" + m.slice(2, 4));

export function AdminView({
  d,
  role,
  announcements,
}: {
  d: AdminDashboard;
  role: Role;
  announcements: AnnouncementRow[];
}) {
  const pendingTotal =
    d.pending.payroll + d.pending.leave + d.pending.expenses + d.pending.declarations;
  const pendingHref = d.pending.payroll
    ? "/payroll"
    : d.pending.leave
      ? "/leave"
      : d.pending.expenses
        ? "/expenses"
        : "/tax";
  const actions = [
    can(role, "payroll:create") && {
      href: "/payroll",
      label: "Start a payroll run",
      icon: <Rocket className="size-4" />,
    },
    can(role, "employees:write") && {
      href: "/employees/new",
      label: "Add an employee",
      icon: <UserPlus className="size-4" />,
    },
    can(role, "leave:approve") && {
      href: "/leave",
      label: "Review leave requests",
      icon: <Plane className="size-4" />,
    },
    can(role, "expenses:approve") && {
      href: "/expenses",
      label: "Review expense claims",
      icon: <Receipt className="size-4" />,
    },
    can(role, "attendance:manage") && {
      href: "/attendance",
      label: "Attendance and month lock",
      icon: <CalendarCheck className="size-4" />,
    },
    can(role, "payroll:read") && {
      href: "/compliance",
      label: "Compliance calendar",
      icon: <Landmark className="size-4" />,
    },
    can(role, "reports:read") && {
      href: "/reports",
      label: "Reports",
      icon: <BarChart3 className="size-4" />,
    },
    can(role, "audit:read") && {
      href: "/audit",
      label: "Audit log",
      icon: <FileText className="size-4" />,
    },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[];
  const trend = d.trend.map((t) => ({ label: short(t.month), value: t.employerCost }));

  return (
    <div className="space-y-6">
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item>
          <KpiCard
            label="Total payroll cost"
            kind="inr"
            icon="banknote"
            value={d.latestRun?.employerCost ?? 0}
            hint={
              d.latestRun
                ? `${monthLabel(d.latestRun.month)} · ${d.latestRun.employees} paid`
                : "No approved run yet"
            }
            spark={d.trend.map((t) => t.employerCost)}
            href="/payroll"
          />
        </Item>
        <Item>
          <KpiCard
            label="Active headcount"
            kind="count"
            icon="users"
            value={d.headcount}
            hint="Employees on payroll"
            href={can(role, "employees:read") ? "/employees" : undefined}
          />
        </Item>
        <Item>
          <KpiCard
            label="Pending approvals"
            kind="count"
            icon="clipboard"
            value={pendingTotal}
            hint={
              pendingTotal
                ? `${d.pending.payroll} payroll · ${d.pending.leave} leave · ${d.pending.expenses} expense · ${d.pending.declarations} tax`
                : "All clear"
            }
            href={pendingHref}
          />
        </Item>
        <Item>
          <KpiCard
            label="Tax (TDS) deducted"
            kind="inr"
            icon="wallet"
            value={d.latestRun?.tds ?? 0}
            hint={
              d.latestRun
                ? `In ${monthLabel(d.latestRun.month)} · due via challan 281`
                : "No approved run yet"
            }
            href="/compliance"
          />
        </Item>
      </Stagger>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Payroll cost trend</CardTitle>
            <CardDescription>Employer cost per month, from approved runs.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <AreaChart
                data={trend}
                format="inrCompact"
                ariaLabel="Employer payroll cost by month"
              />
            ) : (
              <EmptyState art="chart" title="No payroll history yet">
                Approve your first run and the trend appears here.
              </EmptyState>
            )}
          </CardContent>
        </Card>
        <CountdownCard {...d.countdown} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Cost by department</CardTitle>
            <CardDescription>Latest approved month.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.departments.length ? (
              <Donut
                slices={d.departments.map((x) => ({ label: x.department, value: x.cost }))}
                format="inrCompact"
                ariaLabel="Payroll cost share by department"
              />
            ) : (
              <EmptyState art="chart" title="No data yet" />
            )}
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <InsightsPanel insights={d.insights} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeed items={d.activity} />
        <div className="space-y-6">
          <Announcements items={announcements} canManage={can(role, "announcements:manage")} />
          <QuickActions actions={actions} />
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<
  TeamStatus,
  [string, "success" | "warning" | "danger" | "neutral" | "primary"]
> = {
  present: ["Present", "success"],
  late: ["Late", "warning"],
  on_leave: ["On leave", "primary"],
  absent: ["Absent", "danger"],
  not_in: ["Not in yet", "neutral"],
  off: ["Day off", "neutral"],
};

export function TeamView({
  d,
  announcements,
  canManage,
}: {
  d: TeamDashboard;
  announcements: AnnouncementRow[];
  canManage: boolean;
}) {
  const inToday = d.counts.present + d.counts.late;
  const approvals = d.pending.leave + d.pending.expenses;
  return (
    <div className="space-y-6">
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item>
          <KpiCard
            label="Team size"
            kind="count"
            icon="users"
            value={d.members.length}
            hint="Direct reports"
          />
        </Item>
        <Item>
          <KpiCard
            label="In today"
            kind="count"
            icon="calendar"
            value={inToday}
            hint={`${d.counts.on_leave} on leave · ${d.counts.absent} absent · ${d.counts.not_in} not in yet`}
            href="/attendance"
          />
        </Item>
        <Item>
          <KpiCard
            label="Approvals waiting"
            kind="count"
            icon="clipboard"
            value={approvals}
            hint={`${d.pending.leave} leave · ${d.pending.expenses} expense`}
            href={d.pending.leave ? "/leave" : "/expenses"}
          />
        </Item>
        <Item>
          {d.monthlyCost !== null ? (
            <KpiCard
              label="Team cost / month"
              kind="inr"
              icon="banknote"
              value={d.monthlyCost}
              hint="Total CTC of direct reports"
            />
          ) : (
            <KpiCard
              label="Pending expenses"
              kind="count"
              icon="receipt"
              value={d.pending.expenses}
              href="/expenses"
            />
          )}
        </Item>
      </Stagger>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team attendance today</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{m.name}</span>
                  <Badge tone={STATUS_LABEL[m.status][1]}>{STATUS_LABEL[m.status][0]}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Attendance patterns to review</CardTitle>
            <CardDescription>
              Last 30 days: 4 or more late arrivals, or 3 or more absences. Predictive attrition
              scoring comes in Phase 9.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.signals.length === 0 ? (
              <EmptyState art="people" title="No unusual patterns">
                Nobody on your team crosses those thresholds.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {d.signals.map((s) => (
                  <li key={s.employeeId} className="flex items-center justify-between py-2 text-sm">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {s.lateDays} late · {s.absentDays} absent
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Announcements items={announcements} canManage={canManage} />
    </div>
  );
}

export function MeView({
  d,
  announcements,
  canManage,
}: {
  d: EmployeeDashboard;
  announcements: AnnouncementRow[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item>
          <KpiCard
            label="Latest net pay"
            kind="inr"
            icon="wallet"
            value={d.latest?.net ?? 0}
            hint={d.latest ? monthLabel(d.latest.month) : "No payslip yet"}
            href="/payslips"
            spark={d.history.map((h) => h.net)}
          />
        </Item>
        {d.leave.slice(0, 2).map((l) => (
          <Item key={l.code}>
            <KpiCard
              label={`${l.name} left`}
              kind="count"
              icon="plane"
              value={l.left}
              hint={`of ${l.allotted} this year`}
              href="/leave"
            />
          </Item>
        ))}
        <Item>
          <KpiCard
            label="Tax deducted this year"
            kind="inr"
            icon="landmark"
            value={d.tax.ytdTds}
            hint={`${d.tax.regime === "old" ? "Old" : "New"} regime`}
            href="/tax"
          />
        </Item>
      </Stagger>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Take-home history</CardTitle>
              <CardDescription>Net pay for your last payslips.</CardDescription>
            </div>
            {d.latest?.payslipId && (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/payslips/${d.latest.payslipId}/pdf`}>
                  <Download /> Latest payslip
                </a>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {d.history.length ? (
              <AreaChart
                data={d.history.map((h) => ({ label: short(h.month), value: h.net }))}
                format="inr"
                ariaLabel="Your net pay by month"
              />
            ) : (
              <EmptyState art="chart" title="No payslips yet">
                Your pay history appears once payroll is approved.
              </EmptyState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {d.leave.length === 0 ? (
              <EmptyState art="calendar" title="No leave types set up" />
            ) : (
              d.leave.map((l) => (
                <div key={l.code}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{l.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {l.left} / {l.allotted}
                    </span>
                  </div>
                  <div
                    className="bg-muted h-2 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuenow={l.left}
                    aria-valuemin={0}
                    aria-valuemax={l.allotted}
                    aria-label={`${l.name} days left`}
                  >
                    <div
                      className="bg-primary h-full rounded-full transition-[width] duration-700"
                      style={{
                        width: `${l.allotted ? Math.min(100, (l.left / l.allotted) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link href="/leave">Apply for leave</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tax summary</CardTitle>
            <CardDescription>
              Declaration:{" "}
              <Badge
                tone={
                  d.tax.status === "verified"
                    ? "success"
                    : d.tax.status === "rejected"
                      ? "danger"
                      : "neutral"
                }
              >
                {d.tax.status === "none" ? "not submitted" : d.tax.status}
              </Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.tax.annualTax !== null && (
              <p className="text-sm">
                Projected tax for the year under the {d.tax.regime} regime:{" "}
                <span className="font-semibold tabular-nums">{formatINR(d.tax.annualTax)}</span>
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Tax-saving pointers, worked out from your own declaration:
            </p>
            {d.tips.length === 0 ? (
              <p className="text-sm">You&apos;re using your deductions well. Nothing to add.</p>
            ) : (
              <ul className="space-y-2">
                {d.tips.map((t) => (
                  <li key={t.id} className="bg-muted/50 rounded-lg px-3 py-2">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-muted-foreground text-xs">{t.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href="/tax">Open tax declarations</Link>
            </Button>
          </CardContent>
        </Card>
        <Announcements items={announcements} canManage={canManage} />
      </div>
    </div>
  );
}
