"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck } from "lucide-react";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

export interface BellItem {
  id: string;
  title: string;
  href: string | null;
  at: string;
  unread: boolean;
}

const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function NotificationBell({
  items: serverItems,
  unread: serverUnread,
}: {
  items: BellItem[];
  unread: number;
}) {
  const router = useRouter();
  const [live, setLive] = useState<BellItem[]>([]);
  // Pushed over server-sent events; the server-rendered list takes over again after any refresh.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("notification", (e) => {
      const n = JSON.parse((e as MessageEvent).data) as BellItem;
      setLive((l) => (l.some((x) => x.id === n.id) ? l : [n, ...l]));
      router.refresh();
    });
    return () => es.close();
  }, [router]);
  const known = new Set(serverItems.map((i) => i.id));
  const pushed = live.filter((l) => !known.has(l.id));
  const items = [...pushed, ...serverItems].slice(0, 8);
  const unread = serverUnread + pushed.filter((p) => p.unread).length;
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const mark = (id: string | null) =>
    start(async () => {
      await markNotificationsReadAction(id);
      router.refresh();
    });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        data-tour="bell"
        className="hover:bg-muted relative grid size-9 place-items-center rounded-lg transition-colors"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="bg-destructive text-primary-foreground absolute top-1 right-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="bg-card z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => mark(null)}
                className="text-primary flex items-center gap-1 text-xs hover:underline"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <div className="flex gap-2 px-3 py-2.5">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.unread ? "bg-primary" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className={cn("text-sm", n.unread && "font-medium")}>{n.title}</p>
                      <time dateTime={n.at} className="text-muted-foreground text-xs">
                        {fmt.format(new Date(n.at))}
                      </time>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => {
                          setOpen(false);
                          if (n.unread) mark(n.id);
                        }}
                        className="hover:bg-muted/60 block"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => n.unread && mark(n.id)}
                        className="hover:bg-muted/60 block w-full text-left"
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
