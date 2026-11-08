"use client";

import { useState, useTransition } from "react";
import { Copy, Download, Loader2, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { generateDocumentAction } from "@/app/actions/generate";
import { Button } from "@/components/ui/button";
import { GEN_LABEL, type GenKind } from "@/lib/gen/schema";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select";
  options?: string[];
  def?: string | number;
};
const FIELDS: Record<GenKind, Field[]> = {
  offer_letter: [
    { key: "candidateName", label: "Candidate name" },
    { key: "role", label: "Role" },
    { key: "department", label: "Department" },
    { key: "location", label: "Location" },
    { key: "annualCtcRupees", label: "Annual CTC (₹)", type: "number" },
    { key: "joiningDate", label: "Joining date", type: "date" },
    { key: "probationMonths", label: "Probation (months)", type: "number", def: 6 },
    { key: "reportingTo", label: "Reporting to (optional)" },
  ],
  appointment_letter: [
    { key: "employeeName", label: "Employee name" },
    { key: "role", label: "Role" },
    { key: "department", label: "Department" },
    { key: "location", label: "Location" },
    { key: "annualCtcRupees", label: "Annual CTC (₹)", type: "number" },
    { key: "joiningDate", label: "Joining date", type: "date" },
    { key: "probationMonths", label: "Probation (months)", type: "number", def: 6 },
    { key: "noticeDays", label: "Notice period (days)", type: "number", def: 60 },
  ],
  job_description: [
    { key: "role", label: "Role" },
    { key: "department", label: "Department" },
    { key: "location", label: "Location" },
    { key: "experience", label: "Experience (e.g. 3-5 years)" },
    { key: "skills", label: "Key skills", type: "textarea" },
    {
      key: "employmentType",
      label: "Type",
      type: "select",
      options: ["Full-time", "Part-time", "Contract", "Internship"],
      def: "Full-time",
    },
  ],
  announcement_email: [
    { key: "topic", label: "Topic" },
    { key: "details", label: "What to say", type: "textarea" },
    { key: "audience", label: "Audience", def: "All employees" },
    {
      key: "tone",
      label: "Tone",
      type: "select",
      options: ["friendly", "formal", "urgent"],
      def: "friendly",
    },
  ],
};

export function Generator({ kinds }: { kinds: GenKind[] }) {
  const [kind, setKind] = useState<GenKind>(kinds[0]);
  const [result, setResult] = useState<{
    subject: string;
    body: string;
    engine: string;
    note?: string;
  } | null>(null);
  const [pending, start] = useTransition();
  const cls = "border-input bg-background mt-1 w-full rounded-lg border px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Document type" className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Button
            key={k}
            role="tab"
            aria-selected={kind === k}
            size="sm"
            variant={kind === k ? "default" : "outline"}
            onClick={() => {
              setKind(k);
              setResult(null);
            }}
          >
            {GEN_LABEL[k]}
          </Button>
        ))}
      </div>
      <form
        key={kind}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const values: Record<string, unknown> = {};
          for (const f of FIELDS[kind]) {
            const v = String(fd.get(f.key) ?? "").trim();
            if (v === "") continue;
            values[f.key] = f.type === "number" ? Number(v) : v;
          }
          start(async () => {
            const r = await generateDocumentAction({ kind, values });
            if (!r.ok)
              return void toast.error(
                r.fieldErrors ? "Please check the highlighted fields." : r.error,
              );
            setResult({ ...r.data.draft, engine: r.data.engine, note: r.data.note });
          });
        }}
      >
        {FIELDS[kind].map((f) => (
          <label key={f.key} className={`text-sm ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
            {f.label}
            {f.type === "textarea" ? (
              <textarea name={f.key} rows={3} className={cls} required />
            ) : f.type === "select" ? (
              <select name={f.key} defaultValue={f.def} className={`${cls} h-10`}>
                {f.options!.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                name={f.key}
                type={f.type ?? "text"}
                defaultValue={f.def}
                required={!f.label.includes("optional")}
                step={f.type === "number" ? "any" : undefined}
                className={`${cls} h-10`}
              />
            )}
          </label>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate draft
          </Button>
        </div>
      </form>

      {result && (
        <section className="bg-card space-y-3 rounded-2xl border p-4" aria-label="Generated draft">
          <p className="text-muted-foreground text-xs">
            {result.engine === "model"
              ? "Drafted by AI from your inputs."
              : "Standard template filled from your inputs."}
            {result.note ? ` ${result.note}` : ""} Review and edit before sending; have legal review
            letters before use.
          </p>
          <label className="block text-sm">
            Subject
            <input
              value={result.subject}
              onChange={(e) => setResult({ ...result, subject: e.target.value })}
              className={`${cls} h-10`}
            />
          </label>
          <label className="block text-sm">
            Body
            <textarea
              value={result.body}
              onChange={(e) => setResult({ ...result, body: e.target.value })}
              rows={16}
              className={`${cls} font-mono`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${result.subject}\n\n${result.body}`);
                  toast.success("Copied.");
                } catch {
                  toast.error("Could not copy. Select the text and copy it.");
                }
              }}
            >
              <Copy /> Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([`${result.subject}\n\n${result.body}`], { type: "text/plain" }),
                );
                const a = Object.assign(document.createElement("a"), {
                  href: url,
                  download: `${GEN_LABEL[kind].toLowerCase().replace(/\s+/g, "-")}.txt`,
                });
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download /> Download .txt
            </Button>
            {kind === "announcement_email" && (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={`mailto:?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(result.body)}`}
                >
                  <Mail /> Open in email
                </a>
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
