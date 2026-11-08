"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { TOUR_EVENT, TOUR_KEY, TOUR_STEPS, type TourStep } from "@/lib/tour";

type Box = { top: number; left: number; width: number; height: number };

function visibleTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return n;
  }
  return null;
}

/** First-run walkthrough with a spotlight. Starts once per browser, and again from the palette. */
export function ProductTour() {
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    const available = TOUR_STEPS.filter((s) => visibleTarget(s.target));
    if (available.length) {
      setI(0);
      setSteps(available);
    }
  }, []);
  const finish = useCallback(() => {
    setSteps(null);
    try {
      localStorage.setItem(TOUR_KEY, "done");
    } catch {
      /* private mode: the tour simply offers itself again next visit */
    }
  }, []);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(TOUR_KEY) === "done";
    } catch {
      seen = true; // cannot remember, so do not nag
    }
    const t = seen ? undefined : window.setTimeout(start, 900);
    window.addEventListener(TOUR_EVENT, start);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(TOUR_EVENT, start);
    };
  }, [start]);

  const step = steps?.[i];
  useLayoutEffect(() => {
    if (!step) return;
    const place = () => {
      const el = visibleTarget(step.target);
      if (!el) return setBox(null);
      el.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [step]);

  useEffect(() => {
    if (!steps) return;
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setI((n) => Math.min(steps.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [steps, finish]);

  if (!steps || !step || typeof document === "undefined") return null;
  const last = i === steps.length - 1;
  const vw = window.innerWidth;
  const cardW = Math.min(320, vw - 24);
  const top = box ? Math.min(window.innerHeight - 200, box.top + box.height + 12) : 120;
  const left = box ? Math.max(12, Math.min(vw - cardW - 12, box.left)) : 12;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div aria-hidden className="absolute inset-0" onClick={finish} />
      {box && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-[var(--primary)] transition-all duration-300"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          }}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={`Product tour, step ${i + 1} of ${steps.length}`}
        tabIndex={-1}
        className="bg-card absolute rounded-2xl border p-4 shadow-2xl outline-none"
        style={{ top, left, width: cardW }}
      >
        <p className="text-muted-foreground text-xs">
          {i + 1} of {steps.length}
        </p>
        <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="outline" size="sm" onClick={() => setI(i - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? finish() : setI(i + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
