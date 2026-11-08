"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  cancelErasureAction,
  decideErasureAction,
  requestErasureAction,
} from "@/app/actions/privacy";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function RequestErasure() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestErasureAction({ reason: reason || undefined });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Request sent to HR.");
          setReason("");
          setConfirm(false);
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="er-reason">Reason (optional)</Label>
        <Input
          id="er-reason"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        <span>I understand the details listed above will be removed and cannot be restored.</span>
      </label>
      <Button type="submit" variant="outline" disabled={pending || !confirm}>
        Request erasure
      </Button>
    </form>
  );
}

export function CancelErasure({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await cancelErasureAction({ id });
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      Cancel request
    </Button>
  );
}

export function DecideErasure({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideErasureAction({ id, approve, note: note || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success(approve ? "Personal details erased." : "Request declined.");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Note"
        className="max-w-xs"
        placeholder="Note (required to decline)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button size="sm" disabled={pending} onClick={() => decide(true)}>
        Approve and erase
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
        Decline
      </Button>
    </div>
  );
}
