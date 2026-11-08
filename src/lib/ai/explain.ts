import { z } from "zod";
import { formatINR } from "@/lib/money";

export type Lang = "en" | "hi";
export interface Line {
  code: string;
  name: string;
  amount: number;
}
export interface PayslipFacts {
  monthLabel: string;
  gross: number;
  deductions: number;
  net: number;
  earnings: Line[];
  deductionLines: Line[];
  lopDays: number;
  paidDays: number;
}

export const explanationSchema = z.object({
  summary: z.string().min(10).max(600),
  points: z.array(z.string().min(3).max(300)).min(1).max(8),
});
export type Explanation = z.infer<typeof explanationSchema>;

const HI: Record<string, string> = {
  PF: "भविष्य निधि (PF) — आपकी बचत, रिटायरमेंट के लिए जमा होती है",
  ESI: "कर्मचारी राज्य बीमा (ESI) — स्वास्थ्य बीमा योगदान",
  PT: "व्यावसायिक कर (Professional Tax) — राज्य सरकार को",
  TDS: "आयकर (TDS) — आपके अनुमानित वार्षिक कर का मासिक हिस्सा",
};
const EN: Record<string, string> = {
  PF: "Provident Fund — your own savings, kept for retirement",
  ESI: "ESI — health insurance contribution",
  PT: "Professional Tax — paid to the state government",
  TDS: "Income tax (TDS) — this month's share of your estimated yearly tax",
};

/** Deterministic explanation. Used when no AI key is set, when the AI fails, and to cross-check it. */
export function templateExplanation(f: PayslipFacts, lang: Lang): Explanation {
  const biggest = [...f.earnings].sort((a, b) => b.amount - a.amount)[0];
  const pct = f.gross > 0 ? Math.round((f.deductions / f.gross) * 100) : 0;
  const hi = lang === "hi";
  const summary = hi
    ? `${f.monthLabel} में आपकी कुल कमाई ${formatINR(f.gross)} रही। ${formatINR(f.deductions)} कटौती (${pct}%) के बाद आपके खाते में ${formatINR(f.net)} आएंगे।`
    : `For ${f.monthLabel} you earned ${formatINR(f.gross)} in total. After ${formatINR(f.deductions)} of deductions (${pct}% of gross), you take home ${formatINR(f.net)}.`;
  const points: string[] = [];
  if (biggest)
    points.push(
      hi
        ? `सबसे बड़ा हिस्सा "${biggest.name}" है: ${formatINR(biggest.amount)}।`
        : `The largest part is "${biggest.name}": ${formatINR(biggest.amount)}.`,
    );
  for (const d of f.deductionLines.filter((x) => x.amount > 0)) {
    const known = (hi ? HI : EN)[d.code];
    points.push(
      known
        ? `${known}: ${formatINR(d.amount)}`
        : hi
          ? `${d.name}: ${formatINR(d.amount)} की कटौती।`
          : `${d.name}: ${formatINR(d.amount)} deducted.`,
    );
  }
  if (f.lopDays > 0)
    points.push(
      hi
        ? `${f.lopDays} दिन बिना वेतन की छुट्टी (LOP) रही, इसलिए ${f.paidDays} दिन का वेतन मिला।`
        : `You had ${f.lopDays} day(s) of loss of pay, so you were paid for ${f.paidDays} days.`,
    );
  return { summary, points: points.slice(0, 8) };
}

/** Every rupee figure the model mentions must appear in the payslip; otherwise reject it. */
export function figuresAreGrounded(text: string, f: PayslipFacts): boolean {
  const allowed = new Set(
    [
      f.gross,
      f.deductions,
      f.net,
      ...f.earnings.map((l) => l.amount),
      ...f.deductionLines.map((l) => l.amount),
    ].map((p) => formatINR(p).replace(/[^\d]/g, "")),
  );
  const found = text.match(/₹\s?[\d,]+(?:\.\d+)?/g) ?? [];
  return found.every((m) => {
    const digits = m.replace(/[^\d.]/g, "");
    const whole = digits.includes(".") ? digits.replace(/\./, "") : digits + "00";
    return allowed.has(whole) || allowed.has(digits);
  });
}
