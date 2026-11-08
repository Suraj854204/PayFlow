"use client";

import { resolveFormat, type Format } from "./format";
import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface Point {
  label: string;
  value: number;
}

interface Props {
  data: Point[];
  format: Format;
  ariaLabel: string;
  height?: number;
}

/** Animated area chart in plain SVG: the line draws in, the fill fades up, hover shows a value. */
export function AreaChart({ data, format: formatProp, ariaLabel, height = 200 }: Props) {
  const format = resolveFormat(formatProp);
  const reduce = useReducedMotion();
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const pad = { l: 8, r: 8, t: 16, b: 24 };
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.value)) * 1.1;
  const x = (i: number) =>
    data.length === 1 ? W / 2 : pad.l + (i * (W - pad.l - pad.r)) / (data.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const line = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${height - pad.b} L${x(0).toFixed(1)},${height - pad.b} Z`;
  const active = hover ?? data.length - 1;

  return (
    <figure className="w-full">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{data[active].label}</span>
        <span className="font-semibold tabular-nums">{format(data[active].value)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={pad.l}
            x2={W - pad.r}
            y1={pad.t + g * (height - pad.t - pad.b)}
            y2={pad.t + g * (height - pad.t - pad.b)}
            stroke="var(--border)"
            strokeDasharray="3 5"
          />
        ))}
        <motion.path
          d={area}
          fill={`url(#${gid})`}
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, delay: 0.3 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
        {data.map((d, i) => (
          <g key={d.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}>
            <rect
              x={x(i) - W / data.length / 2}
              y={0}
              width={W / data.length}
              height={height}
              fill="transparent"
            />
            <circle
              cx={x(i)}
              cy={y(d.value)}
              r={i === active ? 5 : 3}
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth={2}
            />
            {(data.length <= 6 || i % 2 === data.length % 2) && (
              <text
                x={x(i)}
                y={height - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {d.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        {data.map((d) => `${d.label}: ${format(d.value)}`).join(". ")}
      </figcaption>
    </figure>
  );
}
