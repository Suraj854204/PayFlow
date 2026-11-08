"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { navLabel } from "@/i18n/nav-label";
import { ChevronsLeft } from "lucide-react";
import { BrandMark, type BrandInfo } from "./brand";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/nav";
import { canAny, type Role } from "@/lib/rbac";

export function Sidebar({ role, brand }: { role: Role; brand: BrandInfo }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const ts = useTranslations("shell");
  const [collapsed, setCollapsed] = useState(false);

  const items = NAV_ITEMS.filter((i) => !i.anyOf || canAny(role, i.anyOf));
  const groups = ["Workspace", "Admin"] as const;

  return (
    <motion.aside
      animate={{ width: collapsed ? 68 : 244 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className="bg-card/60 sticky top-0 hidden h-dvh shrink-0 flex-col border-r backdrop-blur md:flex"
      aria-label="Primary"
    >
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark brand={brand} showName={!collapsed} />
        </Link>
      </div>

      <nav data-tour="nav" className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {groups.map((g) => {
          const groupItems = items.filter((i) => i.group === g);
          if (groupItems.length === 0) return null;
          return (
            <div key={g} className="space-y-1">
              {!collapsed && (
                <p className="text-muted-foreground px-2 pb-1 text-[11px] font-medium tracking-wider uppercase">
                  {navLabel(t, g)}
                </p>
              )}
              {groupItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? navLabel(t, item.label) : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full"
                      />
                    )}
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{navLabel(t, item.label)}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? ts("expandSidebar") : ts("collapseSidebar")}
        className="text-muted-foreground hover:bg-muted hover:text-foreground m-3 flex h-9 items-center justify-center rounded-lg transition-colors"
      >
        <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
      </button>
    </motion.aside>
  );
}
