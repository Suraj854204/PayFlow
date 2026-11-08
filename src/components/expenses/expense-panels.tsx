"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { decideExpenseAction, submitExpenseAction } from "@/app/actions/expenses";

const sel = "border-input bg-background h-9 w-full rounded-lg border px-2 text-sm";

export function SubmitForm({
  categories,
  today,
}: {
  categories: readonly string[];
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await submitExpenseAction(fd);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Claim submitted.");
          form.reset();
          router.refresh();
        });
      }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="ex-cat">Category</Label>
        <select id="ex-cat" name="category" className={sel}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ex-amount">Amount (Rs)</Label>
        <Input id="ex-amount" name="amount" inputMode="decimal" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ex-date">Date</Label>
        <Input id="ex-date" name="date" type="date" max={today} defaultValue={today} required />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="ex-receipt">Receipt (PDF, PNG, JPG, max 5 MB)</Label>
        <Input
          id="ex-receipt"
          name="receipt"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
        />
      </div>
      <div className="space-y-1 sm:col-span-5">
        <Label htmlFor="ex-desc">Description</Label>
        <Input id="ex-desc" name="description" maxLength={300} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          Submit claim
        </Button>
      </div>
    </form>
  );
}

export function DecideClaim({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (approve: boolean) => {
    const note = approve ? undefined : (window.prompt("Reason for rejecting (required)") ?? "");
    if (!approve && !note) return;
    start(async () => {
      const r = await decideExpenseAction({ claimId: id, approve, note });
      if (!r.ok) return void toast.error(r.error);
      toast.success(approve ? "Approved. It will be paid with the next payroll." : "Rejected.");
      router.refresh();
    });
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => go(true)}>
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => go(false)}>
        Reject
      </Button>
    </div>
  );
}
