"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FlaskConical, Plus, RotateCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  createWorkflowAction,
  decideTaskAction,
  deleteWorkflowAction,
  retryRunAction,
  testWorkflowAction,
  toggleWorkflowAction,
} from "@/app/actions/workflows";
import { Button } from "@/components/ui/button";

export function NewWorkflowButton({
  templateKey,
  label,
  variant = "default",
}: {
  templateKey?: string;
  label: string;
  variant?: "default" | "outline" | "secondary";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createWorkflowAction({ templateKey });
          if (!r.ok) return void toast.error(r.error);
          router.push(`/workflows/${r.data.id}`);
        })
      }
    >
      <Plus /> {label}
    </Button>
  );
}

export function EnableSwitch({
  id,
  enabled,
  name,
}: {
  id: string;
  enabled: boolean;
  name: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? "Turn off" : "Turn on"} ${name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await toggleWorkflowAction({ id, enabled: !enabled });
          if (!r.ok) toast.error(r.error);
          else router.refresh();
        })
      }
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${enabled ? "bg-primary border-primary" : "bg-muted"}`}
    >
      <span
        className={`bg-card absolute top-0.5 size-5 rounded-full shadow transition-all ${enabled ? "left-[1.375rem]" : "left-0.5"}`}
      />
    </button>
  );
}

export function DeleteWorkflowButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete "${name}"? Its run history is kept for the audit trail but it will stop running.`,
          )
        )
          return;
        start(async () => {
          const r = await deleteWorkflowAction({ id });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Automation deleted.");
            router.refresh();
          }
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}

export function TestButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await testWorkflowAction({ id });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Test run started with sample data. Results appear below in a moment.");
          setTimeout(() => router.refresh(), 2500);
        })
      }
    >
      <FlaskConical /> Test run
    </Button>
  );
}

export function RetryButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryRunAction({ runId });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Retried.");
            router.refresh();
          }
        })
      }
    >
      <RotateCw /> Retry
    </Button>
  );
}

export function TaskButtons({
  taskId,
  kind,
  title,
}: {
  taskId: string;
  kind: "task" | "approval";
  title: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (decision: "approved" | "rejected" | "done") =>
    start(async () => {
      const r = await decideTaskAction({ taskId, decision });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(
          decision === "rejected"
            ? "Rejected."
            : decision === "approved"
              ? "Approved."
              : "Marked done.",
        );
        router.refresh();
      }
    });
  return kind === "approval" ? (
    <div className="flex gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => decide("approved")}
        aria-label={`Approve: ${title}`}
      >
        <Check /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => decide("rejected")}
        aria-label={`Reject: ${title}`}
      >
        <X /> Reject
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => decide("done")}
      aria-label={`Mark done: ${title}`}
    >
      <Check /> Done
    </Button>
  );
}
