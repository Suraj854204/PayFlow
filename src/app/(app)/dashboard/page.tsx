import Link from "next/link";
import { eq } from "drizzle-orm";
import { AdminView, MeView, TeamView } from "@/components/dashboard/views";
import { ViewTabs, type ViewKey } from "@/components/dashboard/view-tabs";
import { requireContext } from "@/lib/auth/context";
import { loadAdminDashboard } from "@/lib/dashboard/load-admin";
import { loadAnnouncements, loadEmployeeDashboard } from "@/lib/dashboard/load-employee";
import { loadTeamDashboard } from "@/lib/dashboard/load-team";
import { withTenant } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { can, canAny } from "@/lib/rbac";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function greeting(hourIst: number) {
  return hourIst < 12 ? "Good morning" : hourIst < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; view?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const today = ist.toISOString().slice(0, 10);
  const isAdminish = canAny(ctx.role, ["payroll:read", "employees:write", "org:manage"]);
  const showCost = can(ctx.role, "team:cost");

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const [org] = await tx
      .select({ done: organizations.onboardingCompletedAt })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    const team =
      ctx.employeeId && can(ctx.role, "employees:read_team")
        ? await loadTeamDashboard(tx, ctx.organizationId, ctx.employeeId, today, showCost)
        : null;
    const views: ViewKey[] = [];
    if (isAdminish) views.push("admin");
    if (team) views.push("team");
    if (ctx.employeeId) views.push("me");
    const wanted = (views as string[]).includes(sp.view ?? "") ? (sp.view as ViewKey) : views[0];
    return {
      needsSetup: can(ctx.role, "org:manage") && !org?.done,
      views,
      active: wanted,
      announcements: await loadAnnouncements(tx, ctx.organizationId, today),
      team,
      admin: wanted === "admin" ? await loadAdminDashboard(tx, ctx.organizationId, today) : null,
      me:
        wanted === "me" && ctx.employeeId
          ? await loadEmployeeDashboard(tx, ctx.organizationId, ctx.employeeId, today)
          : null,
    };
  });
  const canPost = can(ctx.role, "announcements:manage");

  return (
    <div className="space-y-6" data-tour="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(ist.getUTCHours())}, {ctx.user.name.split(" ")[0]}
          </h1>
          <p className="text-muted-foreground text-sm">
            {new Intl.DateTimeFormat("en-IN", {
              dateStyle: "full",
              timeZone: "Asia/Kolkata",
            }).format(ist.getTime() - 5.5 * 3600_000)}
          </p>
        </div>
        {data.active && <ViewTabs views={data.views} active={data.active} />}
      </div>

      {data.needsSetup && (
        <div className="border-primary/30 bg-accent text-accent-foreground flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
          <span>
            Finish setting up your company: statutory details, departments, pay schedule and
            holidays.
          </span>
          <Link href="/setup" className="font-medium underline underline-offset-4">
            Continue setup
          </Link>
        </div>
      )}

      {sp.denied && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm"
        >
          You don&apos;t have permission to open that page.
        </div>
      )}

      {data.active === "admin" && data.admin && (
        <AdminView d={data.admin} role={ctx.role} announcements={data.announcements} />
      )}
      {data.active === "team" && data.team && (
        <TeamView d={data.team} announcements={data.announcements} canManage={canPost} />
      )}
      {data.active === "me" && data.me && (
        <MeView d={data.me} announcements={data.announcements} canManage={canPost} />
      )}
      {!data.active && (
        <p className="text-muted-foreground text-sm">
          Your login is not linked to an employee record yet. Ask HR to connect it.
        </p>
      )}
    </div>
  );
}
