"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  closeSurveyAction,
  createSurveyAction,
  submitSurveyAction,
} from "@/app/actions/engagement";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

interface Q {
  id: string;
  text: string;
  kind: "scale" | "text";
}

export function RespondForm({ surveyId, questions }: { surveyId: string; questions: Q[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [pending, start] = useTransition();
  const ready = questions.every((q) => q.kind !== "scale" || typeof answers[q.id] === "number");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await submitSurveyAction({ surveyId, answers });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Thanks. Your answer was recorded anonymously.");
          router.refresh();
        });
      }}
    >
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="text-sm font-medium">{q.text}</legend>
          {q.kind === "scale" ? (
            <div className="flex gap-2" role="radiogroup" aria-label={q.text}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.id] === n}
                  aria-label={`${n} of 5`}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: n }))}
                  className={`size-10 rounded-lg border text-sm font-medium transition-colors ${answers[q.id] === n ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
                >
                  {n}
                </button>
              ))}
              <span className="text-muted-foreground self-center text-xs">
                1 = strongly disagree, 5 = strongly agree
              </span>
            </div>
          ) : (
            <textarea
              aria-label={q.text}
              maxLength={1000}
              rows={3}
              className="bg-card w-full rounded-lg border p-3 text-sm"
              value={String(answers[q.id] ?? "")}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          )}
        </fieldset>
      ))}
      <Button type="submit" disabled={pending || !ready}>
        <Send /> Submit anonymously
      </Button>
    </form>
  );
}

export function CreateSurveyForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [byDepartment, setByDepartment] = useState(false);
  const [qs, setQs] = useState<{ text: string; kind: "scale" | "text" }[]>([
    { text: "I would recommend this company as a place to work.", kind: "scale" },
    { text: "What one thing should we change?", kind: "text" },
  ]);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createSurveyAction({
            title,
            description: description || undefined,
            byDepartment,
            questions: qs,
          });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Survey opened.");
          setTitle("");
          setDescription("");
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="sv-title">Title</Label>
        <Input id="sv-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sv-desc">Description (optional)</Label>
        <Input id="sv-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-2">
        {qs.map((q, i) => (
          <div key={i} className="flex gap-2">
            <Input
              aria-label={`Question ${i + 1}`}
              value={q.text}
              onChange={(e) =>
                setQs(qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
            />
            <select
              aria-label={`Question ${i + 1} type`}
              className="bg-card h-10 rounded-lg border px-2 text-sm"
              value={q.kind}
              onChange={(e) =>
                setQs(
                  qs.map((x, j) =>
                    j === i ? { ...x, kind: e.target.value as "scale" | "text" } : x,
                  ),
                )
              }
            >
              <option value="scale">Rating 1–5</option>
              <option value="text">Comment</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove question ${i + 1}`}
              disabled={qs.length === 1}
              onClick={() => setQs(qs.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={qs.length >= 12}
          onClick={() => setQs([...qs, { text: "", kind: "scale" }])}
        >
          <Plus /> Add question
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={byDepartment}
          onChange={(e) => setByDepartment(e.target.checked)}
        />
        <span>
          Break results down by department
          <span className="text-muted-foreground block text-xs">
            Only departments with at least 5 answers are ever shown.
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending || title.trim().length < 3}>
        Open survey
      </Button>
    </form>
  );
}

export function CloseSurveyButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await closeSurveyAction({ id });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Survey closed.");
          router.refresh();
        })
      }
    >
      Close survey
    </Button>
  );
}
