"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useTheme } from "next-themes";
import {
  Bot,
  CalendarCheck,
  Compass,
  Moon,
  Plane,
  Receipt,
  Rocket,
  Search,
  Sun,
  UserPlus,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { can, canAny, type Permission, type Role } from "@/lib/rbac";
import { TOUR_EVENT } from "@/lib/tour";
import { OPEN_EVENT } from "@/components/paybot/paybot";
import { authClient } from "@/lib/auth/client";

export function CommandPalette({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  const items = NAV_ITEMS.filter((i) => !i.anyOf || canAny(role, i.anyOf));
  const shortcuts: { label: string; href: string; icon: typeof Rocket; perm: Permission }[] = [
    { label: "Start a payroll run", href: "/payroll", icon: Rocket, perm: "payroll:create" },
    { label: "Add an employee", href: "/employees/new", icon: UserPlus, perm: "employees:write" },
    { label: "Apply for leave", href: "/leave", icon: Plane, perm: "leave:apply" },
    {
      label: "Check in or out",
      href: "/attendance",
      icon: CalendarCheck,
      perm: "attendance:read_own",
    },
    { label: "Submit an expense claim", href: "/expenses", icon: Receipt, perm: "expenses:submit" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-card text-muted-foreground hover:bg-muted flex h-9 min-w-9 items-center justify-center gap-2 rounded-lg border px-2.5 text-sm transition-colors sm:w-full sm:max-w-xs sm:justify-start sm:px-3"
        aria-label="Open command palette"
        data-tour="palette"
      >
        <Search className="size-4" />
        <span className="hidden flex-1 text-left sm:block">Search or jump to…</span>
        <kbd className="bg-muted hidden rounded border px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="bg-card fixed top-[18%] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border shadow-2xl">
            <Dialog.Title className="sr-only">Command palette</Dialog.Title>
            <Dialog.Description className="sr-only">
              Search pages and run actions
            </Dialog.Description>
            <Command label="Command palette" className="flex flex-col">
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder="Type a page or action…"
                className="placeholder:text-muted-foreground h-12 border-b bg-transparent px-4 text-sm outline-none"
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="text-muted-foreground px-3 py-6 text-center text-sm">
                  No results found.
                </Command.Empty>
                <Command.Group
                  heading="Go to"
                  className="text-muted-foreground text-xs [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {items.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={item.label}
                      onSelect={() => run(() => router.push(item.href))}
                      className="text-foreground data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
                    >
                      <item.icon className="text-muted-foreground size-4" />
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group
                  heading="Actions"
                  className="text-muted-foreground text-xs [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {shortcuts
                    .filter((a) => can(role, a.perm))
                    .map((a) => (
                      <Command.Item
                        key={a.label}
                        value={a.label}
                        onSelect={() => run(() => router.push(a.href))}
                        className="text-foreground data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
                      >
                        <a.icon className="text-muted-foreground size-4" />
                        {a.label}
                      </Command.Item>
                    ))}
                  <Command.Item
                    value="Take the product tour"
                    onSelect={() => run(() => window.dispatchEvent(new Event(TOUR_EVENT)))}
                    className="text-foreground data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
                  >
                    <Compass className="text-muted-foreground size-4" />
                    Take the product tour
                  </Command.Item>
                  <Command.Item
                    value="Toggle theme"
                    onSelect={() =>
                      run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
                    }
                    className="text-foreground data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
                  >
                    {resolvedTheme === "dark" ? (
                      <Sun className="size-4" />
                    ) : (
                      <Moon className="size-4" />
                    )}
                    Toggle theme
                  </Command.Item>
                  <Command.Item
                    value="Sign out"
                    onSelect={() =>
                      run(async () => {
                        await authClient.signOut();
                        router.replace("/login");
                        router.refresh();
                      })
                    }
                    className="text-foreground data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
                  >
                    Sign out
                  </Command.Item>
                </Command.Group>
                {can(role, "ai:use") && (
                  <Command.Group
                    heading="Ask AI"
                    className="text-muted-foreground text-xs [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    <Command.Item
                      forceMount
                      value={`ask paybot ${search}`}
                      onSelect={() =>
                        run(() =>
                          window.dispatchEvent(
                            new CustomEvent(OPEN_EVENT, {
                              detail: {
                                message: search.trim().length > 2 ? search.trim() : undefined,
                              },
                            }),
                          ),
                        )
                      }
                      className="text-foreground data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm"
                    >
                      <Bot className="text-primary size-4" />
                      {search.trim().length > 2 ? `Ask PayBot: “${search.trim()}”` : "Ask PayBot"}
                    </Command.Item>
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
