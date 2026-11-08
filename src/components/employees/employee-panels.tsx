"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, FileText, Trash2, UserPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import {
  deleteDocumentAction,
  deleteEmployeeAction,
  inviteEmployeeAction,
  revealSensitiveAction,
  startOffboardingAction,
  toggleChecklistItemAction,
  uploadDocumentAction,
} from "@/app/actions/employees";
import { assignSalaryAction } from "@/app/actions/salary";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { router, pending, start };
}

export function RevealSensitive({ employeeId }: { employeeId: string }) {
  const { pending, start } = useRun();
  const [data, setData] = useState<{
    pan: string | null;
    aadhaar: string | null;
    bankAccount: string | null;
  } | null>(null);
  if (data) {
    return (
      <div className="bg-muted rounded-lg p-3 font-mono text-xs" role="status">
        <div>PAN: {data.pan ?? "—"}</div>
        <div>Aadhaar: {data.aadhaar ?? "—"}</div>
        <div>Account: {data.bankAccount ?? "—"}</div>
        <button
          type="button"
          className="text-primary mt-2 font-sans hover:underline"
          onClick={() => setData(null)}
        >
          Hide
        </button>
      </div>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revealSensitiveAction(employeeId);
          if (!r.ok) return void toast.error(r.error);
          setData(r.data);
          toast.message("Revealed. This access was recorded in the audit log.");
        })
      }
    >
      <Eye /> Reveal full details
    </Button>
  );
}

export function ChecklistPanel({
  items,
  canEdit,
}: {
  items: { id: string; kind: string; title: string; doneAt: string | null }[];
  canEdit: boolean;
}) {
  const { router, start } = useRun();
  // Optimistic: the box flips immediately; it rolls back if the server rejects the change.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isDone = (i: { id: string; doneAt: string | null }) => overrides[i.id] ?? Boolean(i.doneAt);
  const groups = ["onboarding", "offboarding"] as const;

  function toggle(id: string, next: boolean) {
    setOverrides((o) => ({ ...o, [id]: next }));
    start(async () => {
      const r = await toggleChecklistItemAction(id, next);
      if (!r.ok) {
        toast.error(r.error);
        setOverrides((o) => {
          const { [id]: _drop, ...rest } = o;
          void _drop;
          return rest;
        });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const list = items.filter((i) => i.kind === g);
        if (list.length === 0) return null;
        const done = list.filter(isDone).length;
        return (
          <div key={g} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold capitalize">{g}</h4>
              <span className="text-muted-foreground text-xs">
                {done} of {list.length} done
              </span>
            </div>
            <div
              className="bg-muted h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={list.length}
            >
              <div
                className="bg-primary h-full transition-all"
                style={{ width: `${(done / list.length) * 100}%` }}
              />
            </div>
            <ul className="space-y-1">
              {list.map((i) => (
                <li key={i.id}>
                  <label
                    className={cn(
                      "hover:bg-muted flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm",
                      !canEdit && "pointer-events-none",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isDone(i)}
                      disabled={!canEdit}
                      onChange={(e) => toggle(i.id, e.target.checked)}
                    />
                    <span className={cn(isDone(i) && "text-muted-foreground line-through")}>
                      {i.title}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function DocumentsPanel({
  employeeId,
  docs,
  canEdit,
}: {
  employeeId: string;
  docs: { id: string; type: string; fileName: string; sizeBytes: number }[];
  canEdit: boolean;
}) {
  const { router, pending, start } = useRun();
  return (
    <div className="space-y-4">
      {canEdit && (
        <form
          className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            fd.set("employeeId", employeeId);
            start(async () => {
              const r = await uploadDocumentAction(fd);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Document uploaded.");
              form.reset();
              router.refresh();
            });
          }}
        >
          <select
            name="type"
            aria-label="Document type"
            className="bg-card h-10 rounded-lg border px-3 text-sm"
          >
            <option value="pan">PAN</option>
            <option value="aadhaar">Aadhaar</option>
            <option value="bank_proof">Bank proof</option>
            <option value="offer_letter">Offer letter</option>
            <option value="resume">Resume</option>
            <option value="other">Other</option>
          </select>
          <input
            name="file"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
            aria-label="File"
            className="file:bg-muted text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2"
          />
          <Button type="submit" disabled={pending}>
            Upload
          </Button>
        </form>
      )}
      <ul className="divide-y rounded-lg border">
        {docs.length === 0 && (
          <li className="text-muted-foreground p-4 text-center text-sm">
            No documents yet. PDF, PNG or JPG up to 5 MB.
          </li>
        )}
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <FileText className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">{d.fileName}</span>
              <span className="text-muted-foreground text-xs">
                {d.type} · {(d.sizeBytes / 1024).toFixed(0)} KB
              </span>
            </span>
            <span className="flex gap-1">
              {canEdit && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/api/documents/${d.id}`}>Download</a>
                </Button>
              )}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Delete ${d.fileName}`}
                  className="text-muted-foreground hover:text-destructive p-2"
                  onClick={() =>
                    start(async () => {
                      const r = await deleteDocumentAction(d.id);
                      if (!r.ok) return void toast.error(r.error);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SalaryRow {
  id: string;
  ctcAnnual: number;
  effectiveFrom: string;
  reason: string | null;
  monthlyGross: number;
  lines: { code: string; name: string; type: string; monthly: number }[];
}

export function SalaryPanel(props: {
  employeeId: string;
  history: SalaryRow[];
  structures: { id: string; name: string }[];
  canEdit: boolean;
  today: string;
}) {
  const { router, pending, start } = useRun();
  const [errors, setErrors] = useState<string | null>(null);
  const current = props.history.find((h) => h.effectiveFrom <= props.today) ?? null;
  const [open, setOpen] = useState<string | null>(current?.id ?? null);

  return (
    <div className="space-y-6">
      {props.history.length === 0 ? (
        <p className="text-muted-foreground text-sm">No salary assigned yet.</p>
      ) : (
        <ul className="space-y-3">
          {props.history.map((h) => (
            <li key={h.id} className="rounded-xl border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setOpen(open === h.id ? null : h.id)}
                aria-expanded={open === h.id}
              >
                <span>
                  <span className="font-medium">{formatINR(h.ctcAnnual)} / year</span>
                  {current?.id === h.id && (
                    <span className="bg-success/15 text-success ml-2 rounded-full px-2 py-0.5 text-xs">
                      Current
                    </span>
                  )}
                  <span className="text-muted-foreground block text-xs">
                    From{" "}
                    {new Date(`${h.effectiveFrom}T00:00:00`).toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                    })}
                    {h.reason ? ` · ${h.reason}` : ""}
                  </span>
                </span>
                <span className="text-muted-foreground text-sm">
                  {formatINR(h.monthlyGross)} / month
                </span>
              </button>
              {open === h.id && (
                <table className="w-full border-t text-sm">
                  <tbody className="divide-y">
                    {h.lines.map((l) => (
                      <tr key={l.code}>
                        <td className="px-4 py-2">{l.name}</td>
                        <td
                          className={cn(
                            "px-4 py-2 text-right tabular-nums",
                            l.type === "deduction" && "text-destructive",
                          )}
                        >
                          {l.type === "deduction" ? "−" : ""}
                          {formatINR(l.monthly)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.canEdit && (
        <form
          className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            let ctc: number;
            try {
              ctc = rupeesToPaise(String(f.get("ctc")).replace(/,/g, ""));
            } catch {
              setErrors("Enter CTC as a number, e.g. 1200000");
              return;
            }
            setErrors(null);
            start(async () => {
              const r = await assignSalaryAction({
                employeeId: props.employeeId,
                structureId: f.get("structureId"),
                ctcAnnual: ctc,
                effectiveFrom: f.get("effectiveFrom"),
                reason: f.get("reason") || undefined,
              });
              if (!r.ok) {
                setErrors(r.error);
                toast.error(r.error);
                return;
              }
              toast.success(props.history.length ? "Salary revised." : "Salary assigned.");
              router.refresh();
            });
          }}
        >
          <h4 className="text-sm font-semibold sm:col-span-2">
            {props.history.length ? "Revise salary" : "Assign salary"}
          </h4>
          <div className="space-y-1.5">
            <Label htmlFor="ctc">Annual CTC (₹)</Label>
            <Input id="ctc" name="ctc" inputMode="decimal" required placeholder="1200000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="structureId">Template</Label>
            <select
              id="structureId"
              name="structureId"
              required
              className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
            >
              {props.structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="effectiveFrom">Effective from</Label>
            <Input
              id="effectiveFrom"
              name="effectiveFrom"
              type="date"
              required
              defaultValue={props.today}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" placeholder="Annual appraisal" />
          </div>
          <div className="sm:col-span-2">
            <FieldError message={errors ?? undefined} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save salary"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function EmployeeActions(props: {
  employeeId: string;
  email: string;
  status: string;
  canInvite: boolean;
  linked: boolean;
}) {
  const { router, pending, start } = useRun();
  const [exitOpen, setExitOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState("");
  const [exitErr, setExitErr] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap gap-2">
      {props.canInvite && !props.linked && (
        <Dialog.Root
          open={inviteOpen}
          onOpenChange={(o) => {
            setInviteOpen(o);
            if (!o) setLink("");
          }}
        >
          <Dialog.Trigger asChild>
            <Button variant="outline">
              <UserPlus /> Invite to PayFlow
            </Button>
          </Dialog.Trigger>
          <Modal
            title="Invite to PayFlow"
            description={`Creates a single-use link for ${props.email}, valid for 7 days. They must sign up or sign in with that email.`}
          >
            {link ? (
              <div className="space-y-3">
                <input
                  readOnly
                  value={link}
                  aria-label="Invite link"
                  className="bg-muted w-full rounded-lg border px-3 py-2 font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    toast.success("Link copied.");
                  }}
                >
                  <Copy /> Copy link
                </Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const role = new FormData(e.currentTarget).get("role");
                  start(async () => {
                    const r = await inviteEmployeeAction({ employeeId: props.employeeId, role });
                    if (!r.ok) return void toast.error(r.error);
                    setLink(r.data.link);
                  });
                }}
              >
                <Label htmlFor="role">Access level</Label>
                <select
                  id="role"
                  name="role"
                  defaultValue="employee"
                  className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="finance">Finance</option>
                  <option value="hr_admin">HR Admin</option>
                </select>
                <Button type="submit" disabled={pending}>
                  Create invite link
                </Button>
              </form>
            )}
          </Modal>
        </Dialog.Root>
      )}

      {props.status !== "exited" && (
        <Dialog.Root open={exitOpen} onOpenChange={setExitOpen}>
          <Dialog.Trigger asChild>
            <Button variant="outline">
              <UserMinus /> Start offboarding
            </Button>
          </Dialog.Trigger>
          <Modal
            title="Start offboarding"
            description="Sets the last working day and creates the offboarding checklist. If the date is today or earlier the employee is marked exited."
          >
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                start(async () => {
                  const r = await startOffboardingAction(props.employeeId, {
                    exitDate: f.get("exitDate"),
                    reason: f.get("reason"),
                  });
                  if (!r.ok) {
                    setExitErr(r.error);
                    return;
                  }
                  toast.success("Offboarding started.");
                  setExitOpen(false);
                  router.refresh();
                });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="exitDate">Last working day</Label>
                <Input id="exitDate" name="exitDate" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exitReason">Reason</Label>
                <Input id="exitReason" name="reason" required placeholder="Resignation" />
              </div>
              <FieldError message={exitErr ?? undefined} />
              <Button type="submit" disabled={pending}>
                Confirm
              </Button>
            </form>
          </Modal>
        </Dialog.Root>
      )}

      <Button
        variant="ghost"
        className="text-destructive"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              "Delete this employee? Their history is kept for audit but they will disappear from lists.",
            )
          )
            return;
          start(async () => {
            const r = await deleteEmployeeAction(props.employeeId);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Employee deleted.");
            router.push("/employees");
            router.refresh();
          });
        }}
      >
        <Trash2 /> Delete
      </Button>
    </div>
  );
}

function Modal({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <Dialog.Content className="bg-card fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-xl">
        <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
        <Dialog.Description className="text-muted-foreground mb-4 text-sm">
          {description}
        </Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
