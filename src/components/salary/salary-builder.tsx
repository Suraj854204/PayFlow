"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import {
  createComponentAction,
  deleteComponentAction,
  deleteStructureAction,
  saveStructureAction,
} from "@/app/actions/salary";
import { computeBreakdown, describeCalc, type CalcType, type SalaryLineInput } from "@/lib/salary";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Component {
  id: string;
  name: string;
  code: string;
  type: "earning" | "deduction";
  calcType: CalcType;
  value: number;
  isTaxable: boolean;
  isPfWage: boolean;
  isSystem: boolean;
}
interface Structure {
  id: string;
  name: string;
  description: string | null;
  componentIds: string[];
}

export function SalaryBuilder({
  components,
  structures,
  canEdit,
}: {
  components: Component[];
  structures: Structure[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Structure | "new" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [compErrors, setCompErrors] = useState<Record<string, string[] | undefined>>({});
  const [calcType, setCalcType] = useState<CalcType>("fixed");

  // Live preview: the same pure engine the server uses, so what you see is what is saved.
  const [previewCtc, setPreviewCtc] = useState("1200000");
  const [previewId, setPreviewId] = useState(structures[0]?.id ?? "");
  const preview = useMemo(() => {
    const s = structures.find((x) => x.id === previewId);
    if (!s) return null;
    let ctc: number;
    try {
      ctc = rupeesToPaise(previewCtc.replace(/,/g, "") || "0");
    } catch {
      return { errors: ["Enter CTC as a number."] };
    }
    const byId = new Map(components.map((c) => [c.id, c]));
    const lines: SalaryLineInput[] = s.componentIds.flatMap((id) => {
      const c = byId.get(id);
      return c
        ? [
            {
              code: c.code,
              name: c.name,
              type: c.type,
              calcType: c.calcType,
              value: c.value,
              isTaxable: c.isTaxable,
              isPfWage: c.isPfWage,
            },
          ]
        : [];
    });
    const r = computeBreakdown(ctc, lines);
    return r.ok ? { breakdown: r.breakdown } : { errors: r.errors };
  }, [previewCtc, previewId, structures, components]);

  function openEditor(s: Structure | "new") {
    setEditing(s);
    setFormError(null);
    if (s === "new") {
      setSelected(components.filter((c) => c.isSystem).map((c) => c.id));
      setName("");
      setDescription("");
    } else {
      setSelected(s.componentIds);
      setName(s.name);
      setDescription(s.description ?? "");
    }
  }

  function saveStructure() {
    start(async () => {
      const r = await saveStructureAction(editing === "new" ? null : (editing as Structure).id, {
        name,
        description: description || undefined,
        componentIds: selected,
      });
      if (!r.ok) {
        setFormError(r.error);
        return;
      }
      toast.success("Template saved.");
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Try a structure</CardTitle>
          <CardDescription>
            See how a CTC splits into monthly components. This runs the same calculation as payroll.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pv-ctc">Annual CTC (₹)</Label>
              <Input
                id="pv-ctc"
                inputMode="decimal"
                value={previewCtc}
                onChange={(e) => setPreviewCtc(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pv-s">Template</Label>
              <select
                id="pv-s"
                value={previewId}
                onChange={(e) => setPreviewId(e.target.value)}
                className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
              >
                {structures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {preview && "errors" in preview && preview.errors && (
            <ul role="alert" className="text-destructive text-sm">
              {preview.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {preview && "breakdown" in preview && preview.breakdown && (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Component</th>
                    <th className="px-4 py-2 text-right font-medium">Monthly</th>
                    <th className="px-4 py-2 text-right font-medium">Annual</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.breakdown.lines.map((l) => (
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
                      <td className="text-muted-foreground px-4 py-2 text-right tabular-nums">
                        {formatINR(l.annual)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 font-medium">
                  <tr>
                    <td className="px-4 py-2">Gross monthly</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatINR(preview.breakdown.grossMonthly)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Templates</CardTitle>
            <CardDescription>Reusable sets of components you assign to employees.</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => openEditor("new")}>
              <Plus /> New template
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {structures.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {s.componentIds
                    .map((id) => components.find((c) => c.id === id)?.code ?? "?")
                    .join(" · ")}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEditor(s)}>
                    Edit
                  </Button>
                  <button
                    type="button"
                    aria-label={`Delete ${s.name}`}
                    className="text-muted-foreground hover:text-destructive p-2"
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete "${s.name}"? Existing salaries keep their saved breakdown.`,
                        )
                      )
                        return;
                      start(async () => {
                        const r = await deleteStructureAction(s.id);
                        if (!r.ok) return void toast.error(r.error);
                        router.refresh();
                      });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {editing && (
            <div className="bg-muted/30 space-y-4 rounded-xl border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="st-name">Template name</Label>
                  <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-desc">Description</Label>
                  <Input
                    id="st-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-medium">Components</legend>
                {components.map((c) => (
                  <label
                    key={c.id}
                    className="hover:bg-muted flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={(e) =>
                        setSelected((cur) =>
                          e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id),
                        )
                      }
                    />
                    <span className="flex-1">
                      {c.name}{" "}
                      <span className="text-muted-foreground font-mono text-xs">{c.code}</span>
                    </span>
                    <span className="text-muted-foreground text-xs">{describeCalc(c)}</span>
                  </label>
                ))}
              </fieldset>
              <FieldError message={formError ?? undefined} />
              <div className="flex gap-2">
                <Button onClick={saveStructure} disabled={pending}>
                  {pending ? "Saving…" : "Save template"}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Components</CardTitle>
          <CardDescription>
            Percentages are of annual CTC or of Basic. Exactly one earning can be the balancing
            figure (it absorbs whatever is left of CTC).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-xl border">
            {components.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium">{c.name}</span>{" "}
                  <span className="text-muted-foreground font-mono text-xs">{c.code}</span>
                  <span className="text-muted-foreground block text-xs">
                    {c.type} · {describeCalc(c)}
                    {c.isTaxable ? "" : " · non-taxable"}
                    {c.isPfWage ? " · PF wage" : ""}
                  </span>
                </span>
                {canEdit && !c.isSystem && (
                  <button
                    type="button"
                    aria-label={`Delete ${c.name}`}
                    className="text-muted-foreground hover:text-destructive p-2"
                    onClick={() =>
                      start(async () => {
                        const r = await deleteComponentAction(c.id);
                        if (!r.ok) return void toast.error(r.error);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form
              className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                const raw = String(f.get("value") || "0").replace(/,/g, "");
                let value: number;
                try {
                  value =
                    calcType === "fixed"
                      ? rupeesToPaise(raw)
                      : calcType === "balancing"
                        ? 0
                        : Math.round(Number(raw) * 100);
                } catch {
                  setCompErrors({ value: ["Enter a number"] });
                  return;
                }
                if (!Number.isFinite(value)) {
                  setCompErrors({ value: ["Enter a number"] });
                  return;
                }
                start(async () => {
                  const r = await createComponentAction({
                    name: f.get("name"),
                    code: f.get("code"),
                    type: f.get("type"),
                    calcType,
                    value,
                    isTaxable: f.get("isTaxable") === "on",
                    isPfWage: f.get("isPfWage") === "on",
                  });
                  if (!r.ok) {
                    setCompErrors(r.fieldErrors ?? {});
                    toast.error(r.error);
                    return;
                  }
                  setCompErrors({});
                  toast.success("Component added.");
                  form.reset();
                  setCalcType("fixed");
                  router.refresh();
                });
              }}
            >
              <h4 className="text-sm font-semibold sm:col-span-3">Add component</h4>
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Name</Label>
                <Input id="c-name" name="name" required aria-invalid={!!compErrors.name} />
                <FieldError message={compErrors.name?.[0]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-code">Code</Label>
                <Input
                  id="c-code"
                  name="code"
                  required
                  placeholder="CONV"
                  aria-invalid={!!compErrors.code}
                />
                <FieldError message={compErrors.code?.[0]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-type">Type</Label>
                <select
                  id="c-type"
                  name="type"
                  className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
                >
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-calc">Calculation</Label>
                <select
                  id="c-calc"
                  value={calcType}
                  onChange={(e) => setCalcType(e.target.value as CalcType)}
                  className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
                >
                  <option value="fixed">Fixed ₹ per month</option>
                  <option value="percent_of_ctc">% of CTC</option>
                  <option value="percent_of_basic">% of Basic</option>
                  <option value="balancing">Balancing figure</option>
                </select>
              </div>
              {calcType !== "balancing" && (
                <div className="space-y-1.5">
                  <Label htmlFor="c-val">{calcType === "fixed" ? "Amount (₹)" : "Percent"}</Label>
                  <Input
                    id="c-val"
                    name="value"
                    inputMode="decimal"
                    required
                    aria-invalid={!!compErrors.value}
                  />
                  <FieldError message={compErrors.value?.[0]} />
                </div>
              )}
              <div className="flex items-end gap-4 pb-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="isTaxable" defaultChecked /> Taxable
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="isPfWage" /> PF wage
                </label>
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" disabled={pending}>
                  Add component
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
