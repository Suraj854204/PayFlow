"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { dismissAnomalyAction, restoreAnomalyAction } from "@/app/actions/anomalies";
import { OPEN_EVENT } from "@/components/paybot/paybot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Anomaly } from "@/lib/anomaly/detect";
import type { RunAnalysis } from "@/lib/anomaly/load";

const TONE = { high: "danger", medium: "warning", low: "neutral" } as const;

export function CopilotPanel({
  runId,
  analysis,
  canReview,
  canAsk,
}: {
  runId: string;
  analysis: RunAnalysis;
  canReview: boolean;
  canAsk: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { summary, checks, anomalies, dismissed } = analysis;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Something went wrong.");
      toast.success(done);
      setTarget(null);
      setReason("");
      router.refresh();
    });

  return (
    <section aria-labelledby="copilot-h" className="bg-card space-y-4 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="text-primary size-4" aria-hidden />
        <h2 id="copilot-h" className="text-base font-semibold">
          Payroll Copilot
        </h2>
        <Badge tone={summary.fail ? "danger" : summary.warn ? "warning" : "success"}>
          {summary.fail
            ? `${summary.fail} blocking`
            : summary.warn
              ? `${summary.warn} to review`
              : "All clear"}
        </Badge>
        {canAsk && (
          <Button
            size="sm"
            variant="outline"
            className="ms-auto"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(OPEN_EVENT, {
                  detail: { message: `Check the ${analysis.month} payroll run` },
                }),
              )
            }
          >
            Ask PayBot to review
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2.5 text-sm">
            {c.status === "pass" ? (
              <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-label="Passed" />
            ) : c.status === "warn" ? (
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-label="Warning" />
            ) : (
              <XCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Failed" />
            )}
            <div className="min-w-0">
              <p className="font-medium">{c.title}</p>
              <p className="text-muted-foreground text-xs">{c.detail}</p>
              {c.fixHref && c.status !== "pass" && (
                <Link
                  href={c.fixHref}
                  className="text-primary text-xs underline underline-offset-2"
                >
                  {c.fixLabel ?? "Fix this"}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <ShieldAlert className="size-4" aria-hidden /> Anomalies
          <span className="text-muted-foreground font-normal">({anomalies.length})</span>
        </h3>
        {anomalies.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing unusual compared with earlier months.
          </p>
        ) : (
          <ul className="space-y-2">
            {anomalies.map((a: Anomaly) => (
              <li key={a.key} className="rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[a.severity]}>{a.severity}</Badge>
                  <p className="font-medium">{a.title}</p>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{a.explanation}</p>
                <p className="mt-1 text-xs">
                  <span className="font-medium">Suggestion:</span> {a.suggestion}
                </p>
                {canReview &&
                  (target === a.key ? (
                    <form
                      className="mt-2 flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(
                          () => dismissAnomalyAction({ runId, key: a.key, reason }),
                          "Marked as expected",
                        );
                      }}
                    >
                      <label className="min-w-48 flex-1 text-xs">
                        Why is this expected?
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={300}
                          required
                          minLength={3}
                          className="border-input bg-background mt-1 h-9 w-full rounded-lg border px-2 text-sm"
                        />
                      </label>
                      <Button size="sm" type="submit" disabled={pending}>
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setTarget(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ms-2 mt-1"
                      onClick={() => setTarget(a.key)}
                    >
                      Mark as expected
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {dismissed.length > 0 && (
          <details className="mt-3 text-xs">
            <summary className="text-muted-foreground cursor-pointer">
              {dismissed.length} marked as expected
            </summary>
            <ul className="mt-2 space-y-1.5">
              {dismissed.map((d) => (
                <li key={d.key} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {d.title} <span className="text-muted-foreground">— {d.reason}</span>
                  </span>
                  {canReview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        act(() => restoreAnomalyAction({ runId, key: d.key }), "Flag restored")
                      }
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
