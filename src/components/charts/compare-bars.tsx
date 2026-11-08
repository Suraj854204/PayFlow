"use client";

import { motion, useReducedMotion } from "framer-motion";
import { resolveFormat, type Format } from "./format";

export interface BarRow {
  label: string;
  values: { name: string; value: number; tone: "primary" | "muted" | "success" }[];
}

const TONE = {
  primary: "bg-primary",
  muted: "bg-muted-foreground/40",
  success: "bg-success",
} as const;

/** Grouped horizontal bars that grow in. A hidden table carries the same numbers for screen readers. */
export function CompareBars({
  rows,
  format: formatProp,
  ariaLabel,
}: {
  rows: BarRow[];
  format: Format;
  ariaLabel: string;
}) {
  const format = resolveFormat(formatProp);
  const reduce = useReducedMotion();
  const max = Math.max(1, ...rows.flatMap((r) => r.values.map((v) => v.value)));
  return (
    <figure aria-label={ariaLabel} className="space-y-4">
      {rows.map((r) => (
        <div key={r.label} aria-hidden>
          <p className="text-muted-foreground mb-1 text-xs font-medium">{r.label}</p>
          <div className="space-y-1.5">
            {r.values.map((v) => (
              <div key={v.name} className="flex items-center gap-2">
                <span className="text-muted-foreground w-20 shrink-0 text-xs">{v.name}</span>
                <div className="bg-muted h-5 flex-1 overflow-hidden rounded-md">
                  <motion.div
                    className={`h-full rounded-md ${TONE[v.tone]}`}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${(v.value / max) * 100}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
                  {format(v.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {rows.flatMap((r) =>
            r.values.map((v) => (
              <tr key={`${r.label}-${v.name}`}>
                <th scope="row">
                  {r.label}, {v.name}
                </th>
                <td>{format(v.value)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </figure>
  );
}
