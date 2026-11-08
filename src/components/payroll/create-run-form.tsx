"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createRunAction } from "@/app/actions/payroll";

export function CreateRunForm({
  defaultMonth,
  maxMonth,
}: {
  defaultMonth: string;
  maxMonth: string;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createRunAction({ month });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.skipped.length)
        toast.warning(`${res.data.skipped.length} employee(s) skipped: no salary assigned.`);
      else toast.success("Draft payroll run created.");
      router.push(`/payroll/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="run-month">Payroll month</Label>
        <Input
          id="run-month"
          type="month"
          value={month}
          max={maxMonth}
          onChange={(e) => setMonth(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={pending || !month}>
        {pending ? "Calculating…" : "Start payroll run"}
      </Button>
    </form>
  );
}
