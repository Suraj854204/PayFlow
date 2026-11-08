"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  cancelEwaAction,
  decideEwaAction,
  requestEwaAction,
  saveEwaSettingsAction,
} from "@/app/actions/ewa";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function RequestForm({ available, min }: { available: number; min: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestEwaAction({ amountRupees: Number(amount) });
          if (!r.ok) return void toast.error(r.error);
          toast.success(
            r.data.status === "approved"
              ? `Approved. It will be deducted from your ${r.data.recoveredInMonth} pay.`
              : "Sent for approval.",
          );
          setAmount("");
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="ewa-amount">Amount (₹)</Label>
        <Input
          id="ewa-amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          placeholder={`${min / 100} to ${available / 100}`}
          className="w-44"
        />
      </div>
      <Button type="submit" disabled={pending || !amount || available <= 0}>
        Request advance
      </Button>
    </form>
  );
}

export function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await cancelEwaAction({ id });
          if (!r.ok) toast.error(r.error);
          else router.refresh();
        })
      }
    >
      Cancel
    </Button>
  );
}

export function DecideButtons({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (approve: boolean) =>
    start(async () => {
      const r = await decideEwaAction({ id, approve });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(approve ? "Approved." : "Declined.");
        router.refresh();
      }
    });
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => go(true)} aria-label={`Approve ${label}`}>
        <Check /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => go(false)}
        aria-label={`Decline ${label}`}
      >
        <X /> Decline
      </Button>
    </div>
  );
}

export function SettingsForm({
  initial,
}: {
  initial: {
    enabled: boolean;
    maxPercent: number;
    monthlyCapRupees: number;
    autoApproveRupees: number;
    maxRequestsPerMonth: number;
  };
}) {
  const router = useRouter();
  const [v, setV] = useState({
    enabled: initial.enabled,
    maxPercent: String(initial.maxPercent),
    monthlyCapRupees: String(initial.monthlyCapRupees),
    autoApproveRupees: String(initial.autoApproveRupees),
    maxRequestsPerMonth: String(initial.maxRequestsPerMonth),
  });
  const [pending, start] = useTransition();
  const num = (k: keyof typeof v, label: string, id: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={String(v[k])}
        onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, "") })}
      />
    </div>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveEwaSettingsAction({
            enabled: v.enabled,
            maxPercent: Number(v.maxPercent),
            monthlyCapRupees: Number(v.monthlyCapRupees),
            autoApproveRupees: Number(v.autoApproveRupees),
            maxRequestsPerMonth: Number(v.maxRequestsPerMonth),
          });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Saved.");
            router.refresh();
          }
        });
      }}
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4"
          checked={v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />
        Let employees draw part of their earned salary
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        {num("maxPercent", "Share of earned pay they can draw (%)", "ewa-pct")}
        {num("monthlyCapRupees", "Most per month (₹)", "ewa-cap")}
        {num("autoApproveRupees", "Approve automatically up to (₹)", "ewa-auto")}
        {num("maxRequestsPerMonth", "Requests per month", "ewa-count")}
      </div>
      <Button type="submit" disabled={pending}>
        Save rules
      </Button>
    </form>
  );
}
