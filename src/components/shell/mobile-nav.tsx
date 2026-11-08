"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { navLabel } from "@/i18n/nav-label";
import { BrandMark, type BrandInfo } from "./brand";
import { NAV_ITEMS } from "@/lib/nav";
import { canAny, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";

/** Slide-in navigation for screens below the md breakpoint, where the sidebar is hidden. */
export function MobileNav({ role, brand }: { role: Role; brand: BrandInfo }) {
  const t = useTranslations("nav");
  const ts = useTranslations("shell");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const items = NAV_ITEMS.filter((i) => !i.anyOf || canAny(role, i.anyOf));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={ts("openNav")}
        className="hover:bg-muted grid size-9 place-items-center rounded-lg md:hidden"
      >
        <Menu className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:hidden" />
        <Dialog.Content className="bg-card fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r shadow-2xl md:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Jump to a page</Dialog.Description>
          <div className="flex h-14 items-center justify-between px-4">
            <span className="flex items-center gap-2 font-semibold">
              <BrandMark brand={brand} />
            </span>
            <Dialog.Close
              aria-label={ts("closeNav")}
              className="hover:bg-muted grid size-9 place-items-center rounded-lg"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto p-3">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-lg px-3 text-sm",
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <item.icon className="size-4" />
                  {navLabel(t, item.label)}
                </Link>
              );
            })}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
