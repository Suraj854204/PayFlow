"use client";

import { AreaChart } from "@/components/charts/area-chart";
import { Donut } from "@/components/charts/donut";
import { resolveFormat, type FormatKind } from "@/components/charts/format";
import type { ChatChart } from "@/lib/db/schema";

const kindFor = (unit: ChatChart["unit"]): FormatKind =>
  unit === "inr" ? "inrCompact" : unit === "percent" ? "percent" : "count";

/** Renders a chart the report builder produced. Bars are plain divs so they stay light and readable. */
export function ChartView({ chart }: { chart: ChatChart }) {
  const kind = kindFor(chart.unit);
  const format = resolveFormat(kind);
  if (chart.points.length === 0)
    return <p className="text-muted-foreground text-xs">No data for this report yet.</p>;
  return (
    <figure className="bg-card mt-2 rounded-xl border p-3">
      <figcaption className="mb-2 text-xs font-medium">{chart.title}</figcaption>
      {chart.kind === "donut" ? (
        <Donut slices={chart.points} format={kind} ariaLabel={chart.title} />
      ) : chart.kind === "line" ? (
        <AreaChart
          data={chart.points}
          format={chart.unit === "inr" ? "inr" : kind}
          ariaLabel={chart.title}
          height={150}
        />
      ) : (
        <ul className="space-y-1.5" aria-label={chart.title}>
          {(() => {
            const max = Math.max(1, ...chart.points.map((p) => p.value));
            return chart.points.map((p) => (
              <li
                key={p.label}
                className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground truncate" title={p.label}>
                  {p.label}
                </span>
                <span className="bg-muted h-2.5 overflow-hidden rounded-full" aria-hidden>
                  <span
                    className="bg-primary block h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${(Math.max(0, p.value) / max) * 100}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">{format(p.value)}</span>
              </li>
            ));
          })()}
        </ul>
      )}
    </figure>
  );
}
