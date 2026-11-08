"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown for assistant replies. Raw HTML is never rendered; links to this app use the router. */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (p) => <p className="mb-2 last:mb-0" {...p} />,
        ul: (p) => <ul className="mb-2 list-disc space-y-1 ps-5 last:mb-0" {...p} />,
        ol: (p) => <ol className="mb-2 list-decimal space-y-1 ps-5 last:mb-0" {...p} />,
        strong: (p) => <strong className="font-semibold" {...p} />,
        hr: () => <hr className="my-3" />,
        code: (p) => (
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]" {...p} />
        ),
        table: (p) => (
          <div className="mb-2 overflow-x-auto">
            <table className="w-full text-left text-xs" {...p} />
          </div>
        ),
        th: (p) => <th className="border-b px-2 py-1 font-medium" {...p} />,
        td: (p) => <td className="border-b px-2 py-1" {...p} />,
        a: ({ href = "", children: c }) =>
          href.startsWith("/") ? (
            <Link href={href} className="text-primary underline underline-offset-2">
              {c}
            </Link>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {c}
            </a>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
