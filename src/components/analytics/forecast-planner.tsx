"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AreaChart } from "@/components/charts/area-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { forecastCost, totalForecast, type HirePlan } from "@/lib/analytics/forecast";
import { formatINR, formatINRCompact } from "@/lib/money";
import { addMonths, monthLabel } from "@/lib/payroll/period";

export function ForecastPlanner({
  fromMonth,
  baselineMonthlyCost,
  headcount,
  suggestedAttritionPct,
}: {
  fromMonth: string;
  baselineMonthlyCost: number;
  headcount: number;
  suggestedAttritionPct: number;
}) {
  const [attr, setAttr] = useState(String(suggestedAttritionPct));
  const [backfill, setBackfill] = useState(true);
  const [incr, setIncr] = useState("8");
  const [incrMonth, setIncrMonth] = useState("04");
  const [hires, setHires] = useState<{ month: string; count: string; ctc: string }[]>([
    { month: addMonths(fromMonth, 2), count: "2", ctc: "1200000" },
  ]);
  const planKey = JSON.stringify(
    hires
      .filter((h) => Number(h.count) > 0 && Number(h.ctc) > 0)
      .map((h) => ({ month: h.month, count: Number(h.count), ctcAnnual: Number(h.ctc) * 100 })),
  );
  const plan = useMemo<HirePlan[]>(() => JSON.parse(planKey), [planKey]);
  const incrementMonthFull = useMemo(() => {
    const y = Number(fromMonth.slice(0, 4));
    const cand = `${y}-${incrMonth}`;
    return cand > fromMonth ? cand : `${y + 1}-${incrMonth}`;
  }, [fromMonth, incrMonth]);

  const rows = useMemo(
    () =>
      forecastCost({
        fromMonth,
        baselineMonthlyCost,
        headcount,
        monthlyAttritionRate: (Number(attr) || 0) / 100 / 12,
        backfill,
        hires: plan,
        incrementRate: (Number(incr) || 0) / 100,
        incrementMonth: incrementMonthFull,
      }),
    [fromMonth, baselineMonthlyCost, headcount, attr, backfill, plan, incr, incrementMonthFull],
  );
  const monthOptions = Array.from({ length: 6 }, (_, i) => addMonths(fromMonth, i + 1));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            Starts from what you really paid in {monthLabel(fromMonth)} (
            {formatINR(baselineMonthlyCost)} employer cost, {headcount} people).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fc-attr">Yearly attrition (%)</Label>
              <Input
                id="fc-attr"
                inputMode="decimal"
                value={attr}
                onChange={(e) => setAttr(e.target.value.replace(/[^\d.]/g, ""))}
              />
              <p className="text-muted-foreground text-xs">Suggested from your last 12 months.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-incr">Yearly increment (%)</Label>
              <Input
                id="fc-incr"
                inputMode="decimal"
                value={incr}
                onChange={(e) => setIncr(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-incr-m">Increments start in</Label>
              <select
                id="fc-incr-m"
                className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
                value={incrMonth}
                onChange={(e) => setIncrMonth(e.target.value)}
              >
                {["01", "04", "07", "10"].map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(`2000-${m}`).split(" ")[0]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={backfill}
              onChange={(e) => setBackfill(e.target.checked)}
            />
            Replace people who leave, one month later
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Hiring plan</legend>
            {hires.map((h, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <select
                  aria-label="Start month"
                  className="bg-card h-10 rounded-lg border px-3 text-sm"
                  value={h.month}
                  onChange={(e) =>
                    setHires(hires.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))
                  }
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="People"
                  className="w-24"
                  inputMode="numeric"
                  value={h.count}
                  onChange={(e) =>
                    setHires(
                      hires.map((x, j) =>
                        j === i ? { ...x, count: e.target.value.replace(/\D/g, "") } : x,
                      ),
                    )
                  }
                />
                <span className="text-muted-foreground pb-2 text-sm">people at ₹</span>
                <Input
                  aria-label="Yearly CTC each"
                  className="w-36"
                  inputMode="numeric"
                  value={h.ctc}
                  onChange={(e) =>
                    setHires(
                      hires.map((x, j) =>
                        j === i ? { ...x, ctc: e.target.value.replace(/\D/g, "") } : x,
                      ),
                    )
                  }
                />
                <span className="text-muted-foreground pb-2 text-sm">a year each</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove hire"
                  onClick={() => setHires(hires.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setHires([...hires, { month: monthOptions[0], count: "1", ctc: "1000000" }])
              }
            >
              <Plus /> Add hires
            </Button>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Next 6 months</CardTitle>
          <CardDescription>
            Total over six months: <strong>{formatINR(totalForecast(rows))}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AreaChart
            ariaLabel="Projected monthly employer cost"
            format="inrCompact"
            data={rows.map((r) => ({ label: monthLabel(r.month).slice(0, 3), value: r.cost }))}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="px-3 font-medium">People</th>
                  <th className="px-3 text-right font-medium">Cost</th>
                  <th className="px-3 text-right font-medium">Change</th>
                  <th className="pl-3 text-right font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} className="border-b last:border-0">
                    <td className="py-2 pr-3">{monthLabel(r.month)}</td>
                    <td className="px-3 tabular-nums">{r.headcount}</td>
                    <td className="px-3 text-right tabular-nums">{formatINRCompact(r.cost)}</td>
                    <td className="px-3 text-right tabular-nums">
                      {r.deltaFromPrevious >= 0 ? "+" : ""}
                      {formatINRCompact(r.deltaFromPrevious)}
                    </td>
                    <td className="text-muted-foreground pl-3 text-right text-xs">
                      hires {formatINRCompact(r.parts.hires)} · increments{" "}
                      {formatINRCompact(r.parts.increments)} · attrition −
                      {formatINRCompact(Math.max(0, r.parts.attritionSaving))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">
            A planning estimate, not a budget: it assumes today&apos;s pay levels, spreads attrition
            evenly, and adds about 13% employer on-costs to new hires.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
