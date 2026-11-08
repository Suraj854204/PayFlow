"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { AlertTriangle, Check, Download, FileText, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Input, Label } from "@/components/ui/input";
import {
  approveRunAction,
  cancelRunAction,
  processRunAction,
  recalculateRunAction,
  retryPaymentsAction,
  returnRunAction,
  submitRunAction,
  updateItemAction,
} from "@/app/actions/payroll";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { PAY_TONE, RUN_STEPS, RUN_TONE } from "./status";

export interface RunView {
  id: string;
  month: string;
  monthLabel: string;
  status: keyof typeof RUN_TONE;
  createdByName: string;
  approvedByName: string | null;
  totals: { gross: number; deductions: number; net: number; cost: number; count: number };
}
export interface ItemView {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  paidDays: string;
  lopDays: string;
  overtimeMinutes: number;
  arrears: number;
  bonus: number;
  reimbursement: number;
  otherDeduction: number;
  loanEmi: number;
  gross: number;
  deductions: number;
  net: number;
  onHold: boolean;
  holdReason: string | null;
  warnings: { severity: "error" | "warning" | "info"; message: string }[];
  lines: { code: string; name: string; amount: number; kind: "earning" | "deduction" }[];
  payslipId: string | null;
}
export interface PaymentView {
  id: string;
  name: string;
  amount: number;
  status: keyof typeof PAY_TONE;
  failureReason: string | null;
  providerRef: string | null;
  provider: string;
}
export interface Perms {
  create: boolean;
  approve: boolean;
  process: boolean;
  /** The signed-in user prepared or submitted this run, so they cannot approve it. */
  isMaker: boolean;
}

/** The count-up animation passes fractional values; money must be whole paise. */
const inrRounded = (n: number) => formatINR(Math.round(n));

const rupees = (p: number) => (p / 100).toString();

export function RunBoard({
  run,
  items,
  payments,
  perms,
}: {
  run: RunView;
  items: ItemView[];
  payments: PaymentView[];
  perms: Perms;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  function act<T>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    ok: string,
    after?: (d: T) => void,
  ) {
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(ok);
      after?.(res.data);
      router.refresh();
    });
  }

  const celebrate = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    confetti({ particleCount: 140, spread: 80, origin: { y: 0.3 } });
  };

  const stepIdx = RUN_STEPS.indexOf(run.status as (typeof RUN_STEPS)[number]);
  const hasErrors = items.some((i) => !i.onHold && i.warnings.some((w) => w.severity === "error"));
  const failed = payments.filter((p) => p.status === "failed").length;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Run progress">
        {RUN_STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 capitalize " +
                (run.status === "cancelled"
                  ? "text-muted-foreground"
                  : i < stepIdx || run.status === "paid"
                    ? "border-success/30 bg-success/10 text-success"
                    : i === stepIdx
                      ? "border-primary/40 bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground")
              }
              aria-current={i === stepIdx ? "step" : undefined}
            >
              {(i < stepIdx || run.status === "paid") && <Check className="size-3.5" />}
              {s}
            </span>
            {i < RUN_STEPS.length - 1 && <span className="bg-border h-px w-4" />}
          </li>
        ))}
        {run.status === "cancelled" && <Badge tone="danger">cancelled</Badge>}
      </ol>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Employees", run.totals.count, (n: number) => String(Math.round(n))],
          ["Gross pay", run.totals.gross, inrRounded],
          ["Deductions", run.totals.deductions, inrRounded],
          ["Net pay", run.totals.net, inrRounded],
        ].map(([label, value, fmt]) => (
          <Card key={label as string}>
            <CardContent className="pt-5">
              <p className="text-muted-foreground text-xs">{label as string}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                <AnimatedNumber value={value as number} format={fmt as (n: number) => string} />
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-5">
          <p className="text-muted-foreground mr-auto text-sm">
            Prepared by {run.createdByName}
            {run.approvedByName ? ` · Approved by ${run.approvedByName}` : ""}
          </p>
          {run.status === "draft" && perms.create && (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  act(
                    () => recalculateRunAction({ runId: run.id }),
                    "Recalculated from the latest salaries.",
                  )
                }
              >
                <RefreshCw /> Recalculate
              </Button>
              <Button
                disabled={pending || hasErrors}
                onClick={() =>
                  act(() => submitRunAction({ runId: run.id }), "Submitted for review.")
                }
              >
                Submit for review
              </Button>
            </>
          )}
          {run.status === "review" && perms.approve && (
            <Button
              disabled={pending || perms.isMaker}
              title={
                perms.isMaker
                  ? "You prepared or submitted this run, so someone else must approve it."
                  : undefined
              }
              onClick={() => act(() => approveRunAction({ runId: run.id }), "Run approved.")}
            >
              Approve
            </Button>
          )}
          {(run.status === "review" || run.status === "approved") &&
            (perms.approve || perms.create) && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => act(() => returnRunAction({ runId: run.id }), "Returned to draft.")}
              >
                Return to draft
              </Button>
            )}
          {run.status === "approved" && perms.process && (
            <Button
              disabled={pending}
              onClick={() =>
                act(
                  () => processRunAction({ runId: run.id }),
                  "Payroll processed.",
                  (d) => {
                    if (d.failed === 0) celebrate();
                  },
                )
              }
            >
              {pending ? "Processing…" : "Process payroll"}
            </Button>
          )}
          {run.status === "processing" && perms.process && failed > 0 && (
            <Button
              disabled={pending}
              onClick={() =>
                act(
                  () => retryPaymentsAction({ runId: run.id }),
                  "Retried failed payments.",
                  (d) => {
                    if (d.failed === 0) celebrate();
                  },
                )
              }
            >
              Retry {failed} failed
            </Button>
          )}
          {["approved", "processing", "paid"].includes(run.status) && perms.process && (
            <Button variant="outline" asChild>
              <a href={`/api/payroll/${run.id}/bank-csv`}>
                <Download /> Bank file
              </a>
            </Button>
          )}
          {["draft", "review", "approved"].includes(run.status) &&
            (perms.create || perms.approve) && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Cancel this payroll run? The month can then be run again."))
                    act(() => cancelRunAction({ runId: run.id }), "Run cancelled.");
                }}
              >
                Cancel run
              </Button>
            )}
        </CardContent>
      </Card>

      {hasErrors && run.status === "draft" && (
        <p className="text-destructive flex items-center gap-2 text-sm" role="alert">
          <AlertTriangle className="size-4" /> Some items have errors. Fix them or put them on hold
          before submitting.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Employees</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Paid days</th>
                <th className="py-2 pr-4 text-right font-medium">Gross</th>
                <th className="py-2 pr-4 text-right font-medium">Deductions</th>
                <th className="py-2 pr-4 text-right font-medium">Net</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((i) => (
                <Fragment key={i.id}>
                  <tr className={i.onHold ? "opacity-60" : undefined}>
                    <td className="py-2.5 pr-4">
                      <p className="font-medium">{i.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {i.code}
                        {i.onHold && ` · On hold: ${i.holdReason ?? ""}`}
                      </p>
                      {i.warnings.map((w, k) => (
                        <p
                          key={k}
                          className={
                            "text-xs " +
                            (w.severity === "error" ? "text-destructive" : "text-warning")
                          }
                        >
                          {w.message}
                        </p>
                      ))}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{i.paidDays}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatINR(i.gross)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {formatINR(i.deductions)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-medium tabular-nums">
                      {formatINR(i.net)}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen(open === i.id ? null : i.id)}
                        aria-expanded={open === i.id}
                      >
                        {open === i.id
                          ? "Close"
                          : run.status === "draft" && perms.create
                            ? "Edit"
                            : "Breakdown"}
                      </Button>
                      {i.payslipId && (
                        <Button size="sm" variant="ghost" asChild>
                          <a
                            href={`/api/payslips/${i.payslipId}/pdf`}
                            aria-label={`Payslip for ${i.name}`}
                          >
                            <FileText />
                          </a>
                        </Button>
                      )}
                    </td>
                  </tr>
                  {open === i.id && (
                    <tr>
                      <td colSpan={6} className="bg-muted/30 p-4">
                        <ItemEditor
                          item={i}
                          editable={run.status === "draft" && perms.create}
                          onSaved={() => {
                            setOpen(null);
                            router.refresh();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 pr-4">{p.name}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatINR(p.amount)}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={PAY_TONE[p.status]}>{p.status}</Badge>
                      {p.failureReason && (
                        <p className="text-destructive mt-1 text-xs">{p.failureReason}</p>
                      )}
                    </td>
                    <td className="text-muted-foreground py-2.5 font-mono text-xs">
                      {p.providerRef ?? "-"} <span className="font-sans">({p.provider})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ItemEditor({
  item,
  editable,
  onSaved,
}: {
  item: ItemView;
  editable: boolean;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [hold, setHold] = useState(item.onHold);
  const [reason, setReason] = useState(item.holdReason ?? "");

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const money = (k: string) => {
      try {
        return rupeesToPaise(String(f.get(k) || "0"));
      } catch {
        return NaN;
      }
    };
    const payload = {
      itemId: item.id,
      lopDays: Number(f.get("lopDays") || 0),
      overtimeMinutes: Number(f.get("overtimeMinutes") || 0),
      arrears: money("arrears"),
      bonus: money("bonus"),
      reimbursement: money("reimbursement"),
      otherDeduction: money("otherDeduction"),
      onHold: hold,
      holdReason: hold ? reason : undefined,
    };
    if (
      [payload.arrears, payload.bonus, payload.reimbursement, payload.otherDeduction].some(
        Number.isNaN,
      )
    )
      return void toast.error("Enter amounts as rupees, for example 1500 or 1500.50.");
    start(async () => {
      const res = await updateItemAction(payload);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Updated.");
      onSaved();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-1 text-sm">
        {item.lines.map((l) => (
          <div key={l.kind + l.code} className="flex justify-between">
            <span className={l.kind === "deduction" ? "text-muted-foreground" : undefined}>
              {l.name}
            </span>
            <span className="tabular-nums">
              {l.kind === "deduction" ? "-" : ""}
              {formatINR(l.amount)}
            </span>
          </div>
        ))}
      </div>
      {editable ? (
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          {[
            ["lopDays", "Loss of pay days", item.lopDays],
            ["overtimeMinutes", "Overtime (minutes)", String(item.overtimeMinutes)],
            ["arrears", "Arrears (Rs)", rupees(item.arrears)],
            ["bonus", "Bonus (Rs)", rupees(item.bonus)],
            ["reimbursement", "Reimbursement (Rs)", rupees(item.reimbursement)],
            ["otherDeduction", "Other deduction (Rs)", rupees(item.otherDeduction)],
          ].map(([name, label, value]) => (
            <div key={name} className="space-y-1">
              <Label htmlFor={`${item.id}-${name}`}>{label}</Label>
              <Input
                id={`${item.id}-${name}`}
                name={name}
                defaultValue={value}
                inputMode="decimal"
              />
            </div>
          ))}
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />{" "}
            Hold this employee&apos;s payment
          </label>
          {hold && (
            <div className="col-span-2 space-y-1">
              <Label htmlFor={`${item.id}-reason`}>Reason</Label>
              <Input
                id={`${item.id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" className="col-span-2" disabled={pending}>
            {pending ? "Saving…" : "Save and recalculate"}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          Inputs are locked once the run leaves draft.
        </p>
      )}
    </div>
  );
}
