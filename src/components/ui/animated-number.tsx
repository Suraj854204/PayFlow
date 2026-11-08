"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useMotionValue, useReducedMotion } from "framer-motion";

interface Props {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}

/** Counts up to `value` when scrolled into view. Respects reduced-motion. */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString("en-IN"),
  duration = 1.1,
  className,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = format(value);
      return;
    }
    const unsub = mv.on("change", (v) => {
      node.textContent = format(v);
    });
    if (inView) {
      const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
      return () => {
        controls.stop();
        unsub();
      };
    }
    return unsub;
  }, [inView, value, duration, mv, reduce, format]);

  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      {format(reduce ? value : 0)}
    </span>
  );
}
