"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  addHolidayAction,
  addNationalHolidaysAction,
  completeOnboardingAction,
  removeDepartmentAction,
  removeHolidayAction,
  saveDepartmentsAction,
  saveDesignationsAction,
  savePayScheduleAction,
  saveStatutoryAction,
} from "@/app/actions/setup";
import { INDIAN_STATES } from "@/lib/validation/hr";
import type { ActionResult } from "@/lib/action";

interface Props {
  completed: boolean;
  statutory: Record<
    "state" | "pan" | "tan" | "gstin" | "pfEstablishmentCode" | "esiCode" | "ptRegistrationNo",
    string
  >;
  schedule: { payDay: number; cutoffDay: number };
  departments: { id: string; name: string }[];
  designations: { id: string; title: string }[];
  holidays: { id: string; name: string; date: string }[];
}

const STEPS = [
  "Statutory",
  "Departments",
  "Designations",
  "Pay schedule",
  "Holidays",
  "Finish",
] as const;
const DEPT_PRESETS = [
  "Engineering",
  "Product",
  "Design",
  "Sales",
  "Marketing",
  "Finance",
  "HR",
  "Operations",
  "Support",
];
const DESIG_PRESETS = [
  "Intern",
  "Associate",
  "Software Engineer",
  "Senior Engineer",
  "Team Lead",
  "Manager",
  "Director",
  "VP",
];

export function SetupWizard(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function run<T>(fn: () => Promise<ActionResult<T>>, onOk?: () => void, success?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      if (success) toast.success(success);
      onOk?.();
      router.refresh();
    });
  }

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                i === step
                  ? "border-primary bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full text-[10px]",
                  i < step ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Statutory registrations</CardTitle>
                <CardDescription>
                  Used on payslips, challans and Form 16. All optional now; add them when you have
                  them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
                    run(() => saveStatutoryAction(f), next, "Statutory details saved.");
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="state">State of registration (for Professional Tax)</Label>
                    <select
                      id="state"
                      name="state"
                      defaultValue={props.statutory.state}
                      className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
                    >
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  {(
                    [
                      ["pan", "Company PAN", "ABCDE1234F"],
                      ["tan", "TAN", "ABCD12345E"],
                      ["gstin", "GSTIN", "29ABCDE1234F1Z5"],
                      ["pfEstablishmentCode", "PF establishment code", "KDBNG0012345000"],
                      ["esiCode", "ESI code", ""],
                      ["ptRegistrationNo", "PT registration no.", ""],
                    ] as const
                  ).map(([name, label, ph]) => (
                    <div key={name} className="space-y-1.5">
                      <Label htmlFor={name}>{label}</Label>
                      <Input
                        id={name}
                        name={name}
                        defaultValue={props.statutory[name]}
                        placeholder={ph}
                        aria-invalid={!!errors[name]}
                      />
                      <FieldError message={errors[name]?.[0]} />
                    </div>
                  ))}
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <Button type="button" variant="ghost" onClick={next}>
                      Skip
                    </Button>
                    <Button type="submit" disabled={pending}>
                      {pending ? "Saving…" : "Save and continue"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <ListStep
              title="Departments"
              description="Teams you want to report on. Add presets or your own."
              presets={DEPT_PRESETS}
              existing={props.departments.map((d) => ({ id: d.id, label: d.name }))}
              pending={pending}
              onSave={(names) =>
                run(() => saveDepartmentsAction(names), undefined, "Departments saved.")
              }
              onRemove={(id) => run(() => removeDepartmentAction(id))}
              onBack={back}
              onNext={next}
            />
          )}

          {step === 2 && (
            <ListStep
              title="Designations"
              description="Job titles used on employee profiles and letters."
              presets={DESIG_PRESETS}
              existing={props.designations.map((d) => ({ id: d.id, label: d.title }))}
              pending={pending}
              onSave={(names) =>
                run(() => saveDesignationsAction(names), undefined, "Designations saved.")
              }
              onBack={back}
              onNext={next}
            />
          )}

          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>Pay schedule</CardTitle>
                <CardDescription>
                  Monthly payroll. Attendance is locked on the cut-off day and salary is paid on the
                  pay day.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
                    run(() => savePayScheduleAction(f), next, "Pay schedule saved.");
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="cutoffDay">Attendance cut-off (day of month)</Label>
                    <Input
                      id="cutoffDay"
                      name="cutoffDay"
                      type="number"
                      min={1}
                      max={28}
                      defaultValue={props.schedule.cutoffDay}
                      aria-invalid={!!errors.cutoffDay}
                    />
                    <FieldError message={errors.cutoffDay?.[0]} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="payDay">Pay day (day of month)</Label>
                    <Input
                      id="payDay"
                      name="payDay"
                      type="number"
                      min={1}
                      max={28}
                      defaultValue={props.schedule.payDay}
                      aria-invalid={!!errors.payDay}
                    />
                    <FieldError message={errors.payDay?.[0]} />
                  </div>
                  <div className="flex justify-between sm:col-span-2">
                    <Button type="button" variant="ghost" onClick={back}>
                      Back
                    </Button>
                    <Button type="submit" disabled={pending}>
                      {pending ? "Saving…" : "Save and continue"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {step === 4 && (
            <HolidayStep
              holidays={props.holidays}
              pending={pending}
              run={run}
              onBack={back}
              onNext={next}
            />
          )}

          {step === 5 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {props.completed ? "Setup is complete" : "You're almost there"}
                </CardTitle>
                <CardDescription>
                  Next, add your people and give them a salary structure. Standard components
                  (Basic, HRA, Special allowance) are already created.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" onClick={back}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => completeOnboardingAction(),
                        () => router.push("/employees"),
                        "Setup complete.",
                      )
                    }
                  >
                    {props.completed ? "Go to employees" : "Finish and add employees"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ListStep(props: {
  title: string;
  description: string;
  presets: string[];
  existing: { id: string; label: string }[];
  pending: boolean;
  onSave: (names: string[]) => void;
  onRemove?: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState<string[]>([]);
  const [text, setText] = useState("");
  const have = new Set([
    ...props.existing.map((e) => e.label.toLowerCase()),
    ...draft.map((d) => d.toLowerCase()),
  ]);

  function add(name: string) {
    const n = name.trim();
    if (!n || have.has(n.toLowerCase())) return;
    setDraft((d) => [...d, n]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {props.existing.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {props.existing.map((e) => (
              <span
                key={e.id}
                className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
              >
                {e.label}
                {props.onRemove && (
                  <button
                    type="button"
                    aria-label={`Remove ${e.label}`}
                    onClick={() => props.onRemove?.(e.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {props.presets
            .filter((p) => !have.has(p.toLowerCase()))
            .map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => add(p)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs transition-colors"
              >
                <Plus className="size-3" /> {p}
              </button>
            ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
            setText("");
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add your own"
            aria-label="Add your own"
          />
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
        {draft.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draft.map((d) => (
              <span
                key={d}
                className="bg-accent text-accent-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
              >
                {d}
                <button
                  type="button"
                  aria-label={`Remove ${d}`}
                  onClick={() => setDraft((x) => x.filter((v) => v !== d))}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={props.onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={props.pending || draft.length === 0}
              onClick={() => {
                props.onSave(draft);
                setDraft([]);
              }}
            >
              Save {draft.length > 0 ? `(${draft.length})` : ""}
            </Button>
            <Button onClick={props.onNext} disabled={draft.length > 0}>
              Continue
            </Button>
          </div>
        </div>
        {draft.length > 0 && (
          <p className="text-muted-foreground text-xs">Save your additions before continuing.</p>
        )}
      </CardContent>
    </Card>
  );
}

function HolidayStep(props: {
  holidays: { id: string; name: string; date: string }[];
  pending: boolean;
  run: <T>(fn: () => Promise<ActionResult<T>>, onOk?: () => void, success?: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const year = new Date().getFullYear();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Holidays</CardTitle>
        <CardDescription>
          Holidays are excluded from loss-of-pay and shown on the leave calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {[year, year + 1].map((y) => (
            <Button
              key={y}
              type="button"
              variant="outline"
              size="sm"
              disabled={props.pending}
              onClick={() =>
                props.run(
                  () => addNationalHolidaysAction(y),
                  undefined,
                  `National holidays for ${y} added.`,
                )
              }
            >
              <Plus /> National holidays {y}
            </Button>
          ))}
        </div>
        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            props.run(
              () =>
                addHolidayAction({ name: f.get("name"), date: f.get("date"), isOptional: false }),
              () => form.reset(),
              "Holiday added.",
            );
          }}
        >
          <Input
            name="name"
            placeholder="Holiday name (e.g. Diwali)"
            required
            aria-label="Holiday name"
          />
          <Input name="date" type="date" required aria-label="Holiday date" />
          <Button type="submit" variant="outline" disabled={props.pending}>
            Add
          </Button>
        </form>
        <ul className="divide-y rounded-lg border">
          {props.holidays.length === 0 && (
            <li className="text-muted-foreground p-4 text-center text-sm">No holidays yet.</li>
          )}
          {props.holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>
                {h.name}{" "}
                <span className="text-muted-foreground">
                  ·{" "}
                  {new Date(`${h.date}T00:00:00`).toLocaleDateString("en-IN", {
                    dateStyle: "medium",
                  })}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${h.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => props.run(() => removeHolidayAction(h.id))}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={props.onBack}>
            Back
          </Button>
          <Button onClick={props.onNext}>Continue</Button>
        </div>
      </CardContent>
    </Card>
  );
}
