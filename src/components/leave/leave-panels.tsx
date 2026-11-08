"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  applyLeaveAction,
  cancelLeaveAction,
  createLeaveTypeAction,
  decideLeaveAction,
  seedLeaveTypesAction,
} from "@/app/actions/leave";

const sel = "border-input bg-background h-9 w-full rounded-lg border px-2 text-sm";
type R = { ok: true } | { ok: false; error: string };

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

export function ApplyForm({ types }: { types: { id: string; name: string; isPaid: boolean }[] }) {
  const { pending, run } = useRunner();
  const [half, setHalf] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        const from = String(f.get("from"));
        run(
          () =>
            applyLeaveAction({
              leaveTypeId: f.get("type"),
              fromDate: from,
              toDate: half ? from : f.get("to"),
              halfDay: half,
              reason: f.get("reason") || undefined,
            }) as Promise<R>,
          "Leave requested.",
          () => form.reset(),
        );
      }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="lv-type">Leave type</Label>
        <select id="lv-type" name="type" className={sel} required>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isPaid ? "" : " (unpaid)"}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lv-from">From</Label>
        <Input id="lv-from" name="from" type="date" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lv-to">To</Label>
        <Input id="lv-to" name="to" type="date" required={!half} disabled={half} />
      </div>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Half
        day
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          Request
        </Button>
      </div>
      <div className="space-y-1 sm:col-span-6">
        <Label htmlFor="lv-reason">Reason (optional)</Label>
        <Input id="lv-reason" name="reason" maxLength={300} />
      </div>
    </form>
  );
}

export function CancelButton({ id }: { id: string }) {
  const { pending, run } = useRunner();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => run(() => cancelLeaveAction({ requestId: id }) as Promise<R>, "Cancelled.")}
    >
      Cancel
    </Button>
  );
}

export function DecideButtons({ id }: { id: string }) {
  const { pending, run } = useRunner();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Note"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="h-8 w-40"
      />
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              decideLeaveAction({
                requestId: id,
                approve: true,
                note: note || undefined,
              }) as Promise<R>,
            "Approved.",
          )
        }
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              decideLeaveAction({
                requestId: id,
                approve: false,
                note: note || undefined,
              }) as Promise<R>,
            "Rejected.",
          )
        }
      >
        Reject
      </Button>
    </div>
  );
}

export function TypeForm({ empty }: { empty: boolean }) {
  const { pending, run } = useRunner();
  return (
    <div className="space-y-3">
      {empty && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => seedLeaveTypesAction() as Promise<R>, "Standard leave types added.")
          }
        >
          Add standard leave types
        </Button>
      )}
      <form
        className="grid gap-3 sm:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          run(
            () =>
              createLeaveTypeAction({
                code: f.get("code"),
                name: f.get("name"),
                annualQuota: Number(f.get("quota") || 0),
                isPaid: f.get("paid") === "on",
                carryForwardMax: Number(f.get("carry") || 0),
              }) as Promise<R>,
            "Leave type created.",
            () => form.reset(),
          );
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="lt-code">Code</Label>
          <Input id="lt-code" name="code" required maxLength={8} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="lt-name">Name</Label>
          <Input id="lt-name" name="name" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lt-quota">Days per year</Label>
          <Input id="lt-quota" name="quota" type="number" step="0.5" min={0} defaultValue={0} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lt-carry">Carry forward max</Label>
          <Input id="lt-carry" name="carry" type="number" step="0.5" min={0} defaultValue={0} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="paid" defaultChecked /> Paid
        </label>
        <Button type="submit" disabled={pending}>
          Add type
        </Button>
      </form>
    </div>
  );
}
