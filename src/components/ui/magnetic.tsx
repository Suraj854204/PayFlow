"use client";

import { useRef } from "react";

/**
 * Wraps a button or link so it leans toward a mouse pointer. Plain pointer events and a CSS
 * transform, so it adds almost no JavaScript. Touch input and reduced-motion users get no movement
 * (the global reduced-motion rule also removes the transition).
 */
export function Magnetic({
  children,
  strength = 0.3,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div
      ref={ref}
      className={className}
      style={{ transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== "mouse" || reduce()) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) * strength;
        const y = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}
