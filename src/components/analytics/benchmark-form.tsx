"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveBenchmarkAction } from "@/app/actions/analytics";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function BenchmarkForm({ designations }: { designations: { id: string; title: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState({
    designationId: designations[0]?.id ?? "",
    p25: "",
    p50: "",
    p75: "",
    source: "",
    asOf: new Date().toISOString().slice(0, 10),
  });
  const [pending, start] = useTransition();
  if (designations.length === 0)
    return (
      <p className="text-muted-foreground text-sm">Add designations in Company setup first.</p>
    );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });
  const num = (k: "p25" | "p50" | "p75", label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`bm-${k}`}>{label}</Label>
      <Input
        id={`bm-${k}`}
        inputMode="numeric"
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, "") })}
      />
    </div>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBenchmarkAction({
            designationId: v.designationId,
            p25Rupees: Number(v.p25),
            p50Rupees: Number(v.p50),
            p75Rupees: Number(v.p75),
            source: v.source,
            asOf: v.asOf,
          });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Saved.");
            setV({ ...v, p25: "", p50: "", p75: "" });
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-4">
          <Label htmlFor="bm-des">Designation</Label>
          <select
            id="bm-des"
            className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
            value={v.designationId}
            onChange={set("designationId")}
          >
            {designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        {num("p25", "25th percentile (₹/yr)")}
        {num("p50", "Median (₹/yr)")}
        {num("p75", "75th percentile (₹/yr)")}
        <div className="space-y-1">
          <Label htmlFor="bm-asof">As of</Label>
          <Input id="bm-asof" type="date" value={v.asOf} onChange={set("asOf")} />
        </div>
        <div className="space-y-1 sm:col-span-4">
          <Label htmlFor="bm-src">Where the numbers came from</Label>
          <Input
            id="bm-src"
            value={v.source}
            onChange={set("source")}
            placeholder="e.g. 2026 industry salary survey"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Save range
      </Button>
    </form>
  );
}
