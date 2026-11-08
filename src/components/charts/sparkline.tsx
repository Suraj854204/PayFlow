"use client";

import { motion, useReducedMotion } from "framer-motion";

/** Tiny decorative trend line for KPI cards. The numbers it summarises are always shown beside it. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const reduce = useReducedMotion();
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(i * 100) / (values.length - 1)},${28 - ((v - min) / span) * 24}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" aria-hidden className={className} preserveAspectRatio="none">
      <motion.path
        d={pts}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1 }}
      />
    </svg>
  );
}
