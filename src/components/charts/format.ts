import { formatINR, formatINRCompact } from "@/lib/money";

/** Named formats, because a server component cannot pass a function to a chart. */
export type FormatKind = "inr" | "inrCompact" | "count" | "percent";
export type Format = FormatKind | ((n: number) => string);

const KINDS: Record<FormatKind, (n: number) => string> = {
  inr: formatINR,
  inrCompact: formatINRCompact,
  count: (n) => n.toLocaleString("en-IN"),
  percent: (n) => `${n}%`,
};

export const resolveFormat = (f: Format): ((n: number) => string) =>
  typeof f === "string" ? KINDS[f] : f;
