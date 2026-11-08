import * as React from "react";

type Art = "inbox" | "chart" | "people" | "calendar";

const ART: Record<Art, React.ReactNode> = {
  inbox: (
    <>
      <rect x="14" y="30" width="92" height="52" rx="10" />
      <path d="M14 56h28l6 10h24l6-10h28" />
      <path d="M40 18l8-8M60 14V4M80 18l-8-8" />
    </>
  ),
  chart: (
    <>
      <rect x="14" y="14" width="92" height="68" rx="10" />
      <path d="M28 66l20-20 14 12 28-28" />
      <circle cx="90" cy="30" r="3" />
    </>
  ),
  people: (
    <>
      <circle cx="46" cy="36" r="12" />
      <path d="M22 80c0-14 10-22 24-22s24 8 24 22" />
      <circle cx="82" cy="40" r="9" />
      <path d="M76 62c14-2 24 6 24 18" />
    </>
  ),
  calendar: (
    <>
      <rect x="16" y="20" width="88" height="62" rx="10" />
      <path d="M16 38h88M38 12v14M82 12v14" />
      <path d="M34 54h8M56 54h8M78 54h8M34 68h8M56 68h8" />
    </>
  ),
};

/** Friendly empty state with a small line illustration that follows the theme colour. */
export function EmptyState({
  art = "inbox",
  title,
  children,
}: {
  art?: Art;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <svg
        viewBox="0 0 120 92"
        aria-hidden
        className="text-primary/70 h-20 w-auto"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ART[art]}
      </svg>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="text-muted-foreground max-w-sm text-sm">{children}</div>}
    </div>
  );
}
