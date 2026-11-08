"use client";

import { resolveFormat, type Format } from "./format";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface Slice {
  label: string;
  value: number;
}
export const SLICE_COLORS = [
  "#6366f1",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
  "#84cc16",
  "#ec4899",
];

interface Props {
  slices: Slice[];
  format: Format;
  ariaLabel: string;
  centreLabel?: string;
}

/** Donut chart: segments sweep in one after another; hovering a legend row highlights a segment. */
export function Donut({ slices, format: formatProp, ariaLabel, centreLabel = "Total" }: Props) {
  const format = resolveFormat(formatProp);
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  if (total <= 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox="0 0 140 140"
        role="img"
        aria-label={ariaLabel}
        className="size-36 shrink-0 -rotate-90"
      >
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--muted)" strokeWidth="16" />
        {slices.map((s, i) => {
          const len = (s.value / total) * C;
          const seg = (
            <motion.circle
              key={s.label}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth={active === i ? 20 : 16}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              initial={reduce ? false : { opacity: 0, strokeDasharray: `0 ${C}` }}
              whileInView={{ opacity: 1, strokeDasharray: `${len} ${C - len}` }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.12 }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5 text-sm">
        <p className="text-muted-foreground text-xs">
          {active === null ? centreLabel : slices[active].label}{" "}
          <span className="text-foreground font-semibold tabular-nums">
            {format(active === null ? total : slices[active].value)}
          </span>
        </p>
        <ul className="space-y-1">
          {slices.map((s, i) => (
            <li
              key={s.label}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className="flex items-center gap-2"
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
              />
              <span className="truncate">{s.label}</span>
              <span className="text-muted-foreground ml-auto tabular-nums">
                {Math.round((s.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
