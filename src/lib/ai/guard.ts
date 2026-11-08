/**
 * Guardrails around the language model. Everything here is pure so it can be tested without a model.
 * The real protection against data leaks is structural (tools only return what the signed-in user may
 * see); these functions are the second line: keep PII out of prompts, refuse obvious jailbreaks, and
 * stop instructions hidden in stored text from being treated as commands.
 */

export const MAX_INPUT_CHARS = 2000;

const PII: [string, RegExp][] = [
  ["PAN", /\b[A-Z]{5}\d{4}[A-Z]\b/g],
  ["AADHAAR", /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g],
  ["IFSC", /\b[A-Z]{4}0[A-Z0-9]{6}\b/g],
  ["EMAIL", /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ["PHONE", /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g],
  ["ACCOUNT", /\b\d{9,18}\b/g],
];

/** Replaces PAN, Aadhaar, IFSC, email, phone and bank-account-like numbers with labelled placeholders. */
export function maskPii(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const [label, re] of PII) {
    out = out.replace(re, () => {
      masked++;
      return `[${label} hidden]`;
    });
  }
  return { text: out, masked };
}

/** Deep-masks every string in a JSON-like value. Numbers (amounts in paise) are left alone. */
export function maskDeep<T>(value: T): T {
  if (typeof value === "string") return maskPii(value).text as T;
  if (Array.isArray(value)) return value.map(maskDeep) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)])) as T;
  return value;
}

const JAILBREAK: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(reveal|show|print|repeat|leak)\b.{0,30}\b(system|hidden|initial)\b.{0,20}\b(prompt|instructions?|message)\b/i,
  /\byou are now\b.{0,40}\b(dan|unrestricted|jailbroken|developer mode|no restrictions)\b/i,
  /\b(developer|debug|god|admin) mode\b/i,
  /\bpretend (you have|there are) no (rules|restrictions|limits)\b/i,
];

/** True for clear attempts to override the assistant's rules. Ordinary questions never match. */
export function looksLikeJailbreak(text: string): boolean {
  return JAILBREAK.some((re) => re.test(text));
}

/**
 * Stored text (names, announcements, notes) is data, never instructions. Anything in it that reads like
 * an instruction to the assistant is replaced before the model sees it.
 */
export function neutralizeInstructions(text: string): string {
  let out = text;
  for (const re of JAILBREAK)
    out = out.replace(new RegExp(re.source, "gi"), "[instruction-like text removed]");
  return out.replace(/<\/?(system|assistant|tool|instructions?)>/gi, "");
}

/** Cleans tool output before it goes back to the model: masks PII and neutralises instructions. */
export function sanitizeToolOutput<T>(value: T): T {
  if (typeof value === "string") return neutralizeInstructions(maskPii(value).text) as T;
  if (Array.isArray(value)) return value.map(sanitizeToolOutput) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeToolOutput(v)]),
    ) as T;
  return value;
}

export function clampInput(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, MAX_INPUT_CHARS);
}

/** Rough token estimate (about four characters per token) used only for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Per million tokens, USD. Estimates for budgeting; override with AI_PRICE_IN / AI_PRICE_OUT.
const DEFAULT_PRICE = { in: 0.3, out: 2.5 };
export function estimateCostMicroUsd(input: number, output: number, price = DEFAULT_PRICE): number {
  return Math.round(input * price.in + output * price.out);
}
