"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { explainPayslipAction } from "@/app/actions/explain";
import { Button } from "@/components/ui/button";
import type { Explanation, Lang } from "@/lib/ai/explain";

export function ExplainButton({ payslipId }: { payslipId: string }) {
  const [lang, setLang] = useState<Lang>("en");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    explanation: Explanation;
    engine: string;
    lang: Lang;
  } | null>(null);
  const [pending, start] = useTransition();

  const load = (l: Lang) =>
    start(async () => {
      const r = await explainPayslipAction({ payslipId, lang: l });
      if (!r.ok) return void toast.error(r.error);
      setResult({ ...r.data, lang: l });
    });

  return (
    <div className="w-full sm:w-auto">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!result) load(lang);
        }}
      >
        <Sparkles /> Explain
      </Button>
      {open && (
        <div
          className="bg-muted/50 mt-3 w-full space-y-2 rounded-xl border p-3 text-sm sm:max-w-xl"
          aria-live="polite"
        >
          <div role="group" aria-label="Language" className="flex gap-1">
            {(["en", "hi"] as const).map((l) => (
              <Button
                key={l}
                size="sm"
                variant={lang === l ? "default" : "ghost"}
                aria-pressed={lang === l}
                disabled={pending}
                onClick={() => {
                  setLang(l);
                  load(l);
                }}
              >
                {l === "en" ? "English" : "हिन्दी"}
              </Button>
            ))}
          </div>
          {pending && !result ? (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Working it out…
            </p>
          ) : result ? (
            <div lang={result.lang} className={pending ? "opacity-60" : undefined}>
              <p className="font-medium">{result.explanation.summary}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {result.explanation.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-[11px]">
                {result.engine === "model"
                  ? "Written by AI from your payslip figures."
                  : "Generated from your payslip figures."}{" "}
                Your payslip PDF is the official record.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
