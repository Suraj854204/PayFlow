"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cancelAiAction, confirmAiAction } from "@/app/actions/ai-actions";
import { Button } from "@/components/ui/button";
import type { ActionCard } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<string, string> = {
  executed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  executing: "Running…",
};

/** The confirmation step: shows exactly what will change. Nothing happens until the person confirms. */
export function ActionCardView({ card }: { card: ActionCard }) {
  const router = useRouter();
  const [state, setState] = useState(card);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const open = state.status === "pending";
  const needsWord = state.destructive;
  const ready = !needsWord || typed.trim() === "CONFIRM";

  const confirm = () =>
    start(async () => {
      const r = await confirmAiAction({ id: state.id, confirmText: typed });
      if (r.ok) {
        setState({ ...state, status: "executed", result: r.data.message });
        toast.success(r.data.message);
        router.refresh();
      } else {
        toast.error(r.error);
        // A missing CONFIRM word leaves the card open; any other error means it did not run.
        if (!r.error.startsWith("Type CONFIRM"))
          setState({ ...state, status: "failed", result: r.error });
      }
    });
  const cancel = () =>
    start(async () => {
      const r = await cancelAiAction({ id: state.id });
      if (!r.ok) return void toast.error(r.error);
      setState({ ...state, status: "cancelled" });
    });

  return (
    <section
      aria-label={`Confirm: ${state.title}`}
      className={cn(
        "bg-card mt-2 rounded-xl border p-3 text-sm",
        open && "border-primary/40 shadow-sm",
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{state.title}</p>
          <p className="text-muted-foreground text-xs">{state.summary}</p>
        </div>
        {!open && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              state.status === "executed"
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {STATUS_TEXT[state.status] ?? state.status}
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-1 text-xs" aria-label="What will change">
        {state.changes.map((c) => (
          <li key={c.label + c.after} className="flex flex-wrap items-center gap-x-1.5">
            <span className="text-muted-foreground">{c.label}:</span>
            {c.before && (
              <>
                <span className="line-through opacity-70">{c.before}</span>
                <ArrowRight className="size-3" aria-hidden />
              </>
            )}
            <span className="font-medium">{c.after}</span>
          </li>
        ))}
      </ul>
      {state.warnings.map((w) => (
        <p key={w} className="text-warning mt-2 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
        </p>
      ))}

      {open ? (
        <div className="mt-3 space-y-2">
          {needsWord && (
            <label className="block text-xs">
              This needs an extra confirmation. Type <strong>CONFIRM</strong> to continue.
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="border-input bg-background mt-1 h-9 w-full rounded-lg border px-2 text-sm"
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={confirm} disabled={pending || !ready}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />} Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
              <X /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        state.result && <p className="text-muted-foreground mt-2 text-xs">{state.result}</p>
      )}
    </section>
  );
}
