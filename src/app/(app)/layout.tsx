import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { PayBot } from "@/components/paybot/paybot";
import { starterPrompts } from "@/lib/ai/followups";
import { can } from "@/lib/rbac";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NotificationBell } from "@/components/shell/notification-bell";
import { ProductTour } from "@/components/shell/product-tour";
import { withTenant } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { CommandPalette } from "@/components/shell/command-palette";
import { CompanySwitcher } from "@/components/shell/company-switcher";
import { PwaRegister } from "@/components/pwa/register";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { loadFlags } from "@/lib/enterprise/flags-server";
import { requireContext } from "@/lib/auth/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const active = ctx.companies.find((c) => c.id === ctx.organizationId);
  const bell = await withTenant(ctx.organizationId, async (tx) => {
    const mine = and(
      eq(notifications.organizationId, ctx.organizationId),
      eq(notifications.userId, ctx.user.id),
    );
    const rows = await tx
      .select()
      .from(notifications)
      .where(mine)
      .orderBy(desc(notifications.createdAt))
      .limit(8);
    const [u] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt)));
    return {
      flags: await loadFlags(tx, ctx.organizationId),
      unread: u?.n ?? 0,
      items: rows.map((n) => ({
        id: n.id,
        title: n.title,
        href: n.href,
        at: n.createdAt.toISOString(),
        unread: n.readAt === null,
      })),
    };
  });

  const brand = { name: active?.brandName || "PayFlow", logoUrl: active?.logoUrl ?? null };

  return (
    <div
      className="flex min-h-dvh"
      style={active ? ({ "--brand": active.brandColor } as React.CSSProperties) : undefined}
    >
      <Sidebar role={ctx.role} brand={brand} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
          <MobileNav role={ctx.role} brand={brand} />
          <CompanySwitcher companies={ctx.companies} activeId={ctx.organizationId} />
          <Breadcrumbs />
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
            <CommandPalette role={ctx.role} />
            <NotificationBell items={bell.items} unread={bell.unread} />
            <ThemeToggle />
            <UserMenu name={ctx.user.name} email={ctx.user.email} role={ctx.role} />
          </div>
        </header>
        <ProductTour />
        <PwaRegister />
        {can(ctx.role, "ai:use") && bell.flags.paybot && (
          <PayBot starters={starterPrompts(ctx.role, Boolean(ctx.employeeId))} />
        )}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
