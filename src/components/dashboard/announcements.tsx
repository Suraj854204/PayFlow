"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAnnouncementAction, postAnnouncementAction } from "@/app/actions/announcements";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/input";
import type { AnnouncementRow } from "@/lib/dashboard/load-employee";

const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export function Announcements({
  items,
  canManage,
}: {
  items: AnnouncementRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  function remove(id: string) {
    start(async () => {
      const r = await deleteAnnouncementAction(id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Announcement removed.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="text-primary size-4" aria-hidden /> Announcements
          </CardTitle>
          <CardDescription>News from your company.</CardDescription>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "Close" : "New"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {open && canManage && (
          <form
            className="bg-muted/40 grid gap-3 rounded-xl border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              start(async () => {
                const r = await postAnnouncementAction({
                  title: f.get("title"),
                  body: f.get("body"),
                  pinned: f.get("pinned") === "on",
                  notifyAll: f.get("notify") === "on",
                  expiresOn: f.get("expires") ? String(f.get("expires")) : null,
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Announcement posted.");
                form.reset();
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="an-title">Title</Label>
              <Input id="an-title" name="title" required maxLength={120} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="an-body">Message</Label>
              <textarea
                id="an-body"
                name="body"
                required
                maxLength={2000}
                rows={3}
                className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-end gap-4 text-sm">
              <div className="space-y-1">
                <Label htmlFor="an-exp">Hide after (optional)</Label>
                <Input id="an-exp" name="expires" type="date" />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="pinned" /> Pin to top
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="notify" /> Notify everyone
              </label>
              <Button type="submit" disabled={pending} className="ml-auto">
                Post
              </Button>
            </div>
          </form>
        )}
        {items.length === 0 ? (
          <EmptyState art="inbox" title="No announcements">
            {canManage ? "Post one to reach everyone in the company." : "You're all caught up."}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {a.pinned && <Pin className="text-primary size-3.5" aria-label="Pinned" />}
                    {a.title}
                  </p>
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${a.title}`}
                      disabled={pending}
                      onClick={() => remove(a.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 text-sm whitespace-pre-line">{a.body}</p>
                <p className="text-muted-foreground mt-2 text-xs">{fmt.format(new Date(a.at))}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
