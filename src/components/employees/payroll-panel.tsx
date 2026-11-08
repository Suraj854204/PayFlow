"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  approveSettlementAction,
  cancelLoanAction,
  createLoanAction,
  createSettlementAction,
  paySettlementAction,
} from "@/app/actions/loans";
import { formatINR, rupeesToPaise } from "@/lib/money";

export interface LoanView {
  id: string;
  kind: string;
  principal: number;
  emi: number;
  balance: number;
  startMonth: string;
  status: string;
  repayments: number;
}
export interface SettlementView {
  id: string;
  status: string;
  payable: number;
  lastWorkingDay: string;
  lines: { label: string; amount: number }[];
  createdByMe: boolean;
}

const toPaise = (v: FormDataEntryValue | null) => {
  try {
    return rupeesToPaise(String(v || "0"));
  } catch {
    return NaN;
  }
};

export function LoansPanel({
  employeeId,
  loans,
  canEdit,
  defaultMonth,
}: {
  employeeId: string;
  loans: LoanView[];
  canEdit: boolean;
  defaultMonth: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const principal = toPaise(f.get("principal"));
    const emi = toPaise(f.get("emi"));
    if (Number.isNaN(principal) || Number.isNaN(emi))
      return void toast.error("Enter amounts in rupees, for example 50000.");
    start(async () => {
      const res = await createLoanAction({
        employeeId,
        kind: f.get("kind"),
        principal,
        emi,
        startMonth: f.get("startMonth"),
        reason: f.get("reason") || undefined,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Recorded. The EMI will be deducted from each payroll run.");
      form.reset();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {loans.length === 0 && <p className="text-muted-foreground text-sm">No loans or advances.</p>}
      {loans.map((l) => (
        <div
          key={l.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
        >
          <div>
            <p className="font-medium capitalize">
              {l.kind} of {formatINR(l.principal)}{" "}
              <Badge tone={l.status === "active" ? "primary" : "neutral"}>{l.status}</Badge>
            </p>
            <p className="text-muted-foreground text-xs">
              EMI {formatINR(l.emi)} from {l.startMonth} · Balance {formatINR(l.balance)}
            </p>
          </div>
          {canEdit && l.status === "active" && l.repayments === 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelLoanAction({ loanId: l.id });
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Cancelled.");
                    router.refresh();
                  }
                })
              }
            >
              Cancel
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="loan-kind">Type</Label>
            <select
              id="loan-kind"
              name="kind"
              className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm"
            >
              <option value="loan">Loan</option>
              <option value="advance">Advance</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="loan-principal">Amount (Rs)</Label>
            <Input id="loan-principal" name="principal" inputMode="decimal" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loan-emi">EMI (Rs)</Label>
            <Input id="loan-emi" name="emi" inputMode="decimal" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loan-start">First deduction</Label>
            <Input
              id="loan-start"
              name="startMonth"
              type="month"
              defaultValue={defaultMonth}
              required
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={pending} className="w-full">
              Add
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SettlementPanel({
  employeeId,
  settlement,
  canPrepare,
  canApprove,
  canPay,
  today,
}: {
  employeeId: string;
  settlement: SettlementView | null;
  canPrepare: boolean;
  canApprove: boolean;
  canPay: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function prepare(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const noticeRecovery = toPaise(f.get("notice"));
    const otherRecovery = toPaise(f.get("other"));
    if (Number.isNaN(noticeRecovery) || Number.isNaN(otherRecovery))
      return void toast.error("Enter amounts in rupees.");
    start(async () => {
      const res = await createSettlementAction({
        employeeId,
        lastWorkingDay: f.get("lwd"),
        leaveDays: Number(f.get("leave") || 0),
        noticeRecovery,
        otherRecovery,
        deathOrDisability: f.get("dd") === "on",
      });
      if (!res.ok) return void toast.error(res.error);
      setNote(res.data.gratuityNote);
      toast.success("Settlement prepared.");
      router.refresh();
    });
  }
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      router.refresh();
    });

  return (
    <div className="space-y-4 text-sm">
      {settlement && (
        <div className="rounded-lg border p-3">
          <p className="mb-2 font-medium">
            Last day {settlement.lastWorkingDay}{" "}
            <Badge
              tone={
                settlement.status === "paid"
                  ? "success"
                  : settlement.status === "approved"
                    ? "primary"
                    : "warning"
              }
            >
              {settlement.status}
            </Badge>
          </p>
          {settlement.lines.map((l) => (
            <div key={l.label} className="flex justify-between">
              <span className="text-muted-foreground">{l.label}</span>
              <span className="tabular-nums">{formatINR(l.amount)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
            <span>Payable</span>
            <span className="tabular-nums">{formatINR(settlement.payable)}</span>
          </div>
          <div className="mt-3 flex gap-2">
            {settlement.status === "draft" && canApprove && (
              <Button
                size="sm"
                disabled={pending || settlement.createdByMe}
                title={
                  settlement.createdByMe
                    ? "Someone else must approve a settlement you prepared."
                    : undefined
                }
                onClick={() =>
                  run(() => approveSettlementAction({ settlementId: settlement.id }), "Approved.")
                }
              >
                Approve
              </Button>
            )}
            {settlement.status === "approved" && canPay && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Pay this settlement and mark the employee as exited?"))
                    run(
                      () => paySettlementAction({ settlementId: settlement.id }),
                      "Settlement paid.",
                    );
                }}
              >
                Pay and close
              </Button>
            )}
          </div>
        </div>
      )}
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
      <p className="text-muted-foreground text-xs">
        Gratuity and leave encashment are computed from statutory formulas and assumed within
        tax-exempt limits. HR should review before approval.
      </p>
      {canPrepare && (!settlement || settlement.status === "draft") && (
        <form onSubmit={prepare} className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="s-lwd">Last working day</Label>
            <Input id="s-lwd" name="lwd" type="date" defaultValue={today} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-leave">Leave days to encash</Label>
            <Input id="s-leave" name="leave" type="number" min={0} step="0.5" defaultValue={0} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-notice">Notice recovery (Rs)</Label>
            <Input id="s-notice" name="notice" inputMode="decimal" defaultValue="0" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-other">Other recovery (Rs)</Label>
            <Input id="s-other" name="other" inputMode="decimal" defaultValue="0" />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="dd" /> Death/disability
            </label>
            <Button type="submit" disabled={pending}>
              {settlement ? "Update" : "Prepare"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
