"use client";

import dynamic from "next/dynamic";

/** The sample dashboard is below the fold and heavy on client JS, so it loads after the page is interactive. */
const Preview = dynamic(() => import("./preview").then((m) => m.Preview), {
  ssr: false,
  loading: () => (
    <div className="bg-card/60 h-[34rem] animate-pulse rounded-2xl border" aria-hidden />
  ),
});

export function PreviewLazy() {
  return <Preview />;
}
