"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  rejectExtractionAction,
  verifyExtractionAction,
  type ExtractionView,
} from "@/app/actions/documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DOC_LABEL, FIELD_DEFS, validateFields } from "@/lib/docai/fields";

export function ReviewCard({ doc }: { doc: ExtractionView }) {
  const router = useRouter();
  const [vals, setVals] = useState(doc.fields);
  const [touched, setTouched] = useState(false);
  const [pending, start] = useTransition();
  const { issues } = useMemo(() => validateFields(doc.kind, vals), [doc.kind, vals]);
  const open = doc.status === "review";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Something went wrong.");
      toast.success(ok);
      router.refresh();
    });

  return (
    <section
      className="bg-card rounded-2xl border p-4"
      aria-label={`${DOC_LABEL[doc.kind]} for ${doc.employeeName}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">
          {DOC_LABEL[doc.kind]} · {doc.employeeName}
        </p>
        <Badge
          tone={
            doc.status === "verified"
              ? "success"
              : doc.status === "rejected"
                ? "neutral"
                : "warning"
          }
        >
          {doc.status === "review" ? "Needs verification" : doc.status}
        </Badge>
        {doc.engine === "model" && open && (
          <Badge tone="primary">
            <Sparkles className="size-3" /> Read by AI
          </Badge>
        )}
        <span className="text-muted-foreground ms-auto text-xs">{doc.filename}</span>
      </div>
      {open && (
        <>
          {doc.note && <p className="text-muted-foreground mt-2 text-xs">{doc.note}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FIELD_DEFS[doc.kind].map((f) => (
              <label key={f.key} className="text-sm">
                {f.label}
                <input
                  value={vals[f.key] ?? ""}
                  onChange={(e) => {
                    setTouched(true);
                    setVals({ ...vals, [f.key]: e.target.value });
                  }}
                  autoComplete="off"
                  aria-invalid={Boolean(issues[f.key])}
                  className="border-input bg-background mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                />
                {issues[f.key] && (vals[f.key] || touched) && (
                  <span className="text-destructive text-xs">{issues[f.key]}</span>
                )}
              </label>
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Compare each value with the document. Verifying saves it to the employee record.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={pending || Object.keys(issues).length > 0}
              onClick={() =>
                run(
                  () => verifyExtractionAction({ id: doc.id, fields: vals }),
                  "Verified and saved.",
                )
              }
            >
              <Check /> Verify and save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => rejectExtractionAction(doc.id), "Rejected.")}
            >
              <X /> Reject
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
