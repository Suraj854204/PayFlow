import type { BreakdownLine } from "@/lib/salary";

/** Monthly figures from a salary breakdown that the tax screens need. */
export function computeBreakdownSafe(lines: BreakdownLine[]) {
  const earn = lines.filter((l) => l.type === "earning");
  const code = (c: string) => earn.find((l) => l.code === c)?.monthly ?? 0;
  return {
    basic: code("BASIC"),
    hra: code("HRA"),
    gross: earn.reduce((s, l) => s + l.monthly, 0),
    taxable: earn.filter((l) => l.isTaxable).reduce((s, l) => s + l.monthly, 0),
    pfWages: earn.filter((l) => l.isPfWage).reduce((s, l) => s + l.monthly, 0),
  };
}
