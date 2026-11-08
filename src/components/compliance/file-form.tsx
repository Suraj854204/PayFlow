"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markFiledAction } from "@/app/actions/compliance";
import { rupeesToPaise } from "@/lib/money";

export function FileForm({ id, expected, today }: { id: string; expected: number; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Mark filed
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        let amountPaid: number;
        try {
          amountPaid = rupeesToPaise(String(f.get("amount") || "0").replace(/,/g, ""));
        } catch {
          return void toast.error("Enter the amount in rupees.");
        }
        start(async () => {
          const r = await markFiledAction({
            itemId: id,
            challanNo: f.get("challan"),
            amountPaid,
            paidOn: f.get("paidOn"),
          });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Marked as filed.");
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <Input
        aria-label="Challan or acknowledgement number"
        name="challan"
        placeholder="Challan no."
        required
        className="h-8 w-36"
      />
      <Input
        aria-label="Amount paid in rupees"
        name="amount"
        inputMode="decimal"
        defaultValue={expected ? String(expected / 100) : ""}
        className="h-8 w-28"
      />
      <Input
        aria-label="Paid on"
        name="paidOn"
        type="date"
        max={today}
        defaultValue={today}
        required
        className="h-8 w-36"
      />
      <Button size="sm" type="submit" disabled={pending}>
        Save
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
