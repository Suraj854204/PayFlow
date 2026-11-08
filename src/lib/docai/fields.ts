import { z } from "zod";
import { ACCOUNT_RE, AADHAAR_RE, IFSC_RE, PAN_RE } from "@/lib/validation/hr";

export const DOC_KINDS = ["pan", "aadhaar", "bank_proof", "resume"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_LABEL: Record<DocKind, string> = {
  pan: "PAN card",
  aadhaar: "Aadhaar card",
  bank_proof: "Bank proof (cheque or passbook)",
  resume: "Resume",
};

/** The fields each document type yields, in the order a reviewer sees them. */
export const FIELD_DEFS: Record<DocKind, { key: string; label: string; sensitive?: boolean }[]> = {
  pan: [
    { key: "pan", label: "PAN", sensitive: true },
    { key: "name", label: "Name on card" },
    { key: "dob", label: "Date of birth (YYYY-MM-DD)" },
  ],
  aadhaar: [
    { key: "aadhaar", label: "Aadhaar number", sensitive: true },
    { key: "name", label: "Name on card" },
    { key: "dob", label: "Date of birth (YYYY-MM-DD)" },
  ],
  bank_proof: [
    { key: "accountNumber", label: "Account number", sensitive: true },
    { key: "ifsc", label: "IFSC" },
    { key: "bankName", label: "Bank name" },
    { key: "holderName", label: "Account holder" },
  ],
  resume: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "currentRole", label: "Current role" },
    { key: "yearsExperience", label: "Years of experience" },
    { key: "skills", label: "Skills (comma separated)" },
  ],
};

export type Fields = Record<string, string>;

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
/** Verhoeff checksum, which every genuine Aadhaar number satisfies. */
export function verhoeff(num: string): boolean {
  let c = 0;
  [...num].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

const normalise = (kind: DocKind, f: Fields): Fields => {
  const o: Fields = {};
  for (const { key } of FIELD_DEFS[kind]) o[key] = (f[key] ?? "").toString().trim();
  if (o.pan) o.pan = o.pan.toUpperCase().replace(/\s+/g, "");
  if (o.aadhaar) o.aadhaar = o.aadhaar.replace(/\s+/g, "");
  if (o.accountNumber) o.accountNumber = o.accountNumber.replace(/\s+/g, "");
  if (o.ifsc) o.ifsc = o.ifsc.toUpperCase().replace(/\s+/g, "");
  return o;
};

/** Format checks per field. Returns what is wrong, keyed by field; an empty object means it can be applied. */
export function validateFields(kind: DocKind, raw: Fields): { fields: Fields; issues: Fields } {
  const f = normalise(kind, raw);
  const issues: Fields = {};
  const need = (k: string, ok: boolean, msg: string) => {
    if (!f[k]) issues[k] = "Required";
    else if (!ok) issues[k] = msg;
  };
  if (kind === "pan") need("pan", PAN_RE.test(f.pan), "PAN looks like ABCDE1234F");
  if (kind === "aadhaar")
    need(
      "aadhaar",
      AADHAAR_RE.test(f.aadhaar) && verhoeff(f.aadhaar),
      "Not a valid Aadhaar number",
    );
  if (kind === "bank_proof") {
    need("accountNumber", ACCOUNT_RE.test(f.accountNumber), "9 to 18 digits");
    need("ifsc", IFSC_RE.test(f.ifsc), "IFSC looks like HDFC0001234");
  }
  if (kind === "resume") {
    need("name", f.name.length >= 2, "Required");
    if (f.email && !z.string().email().safeParse(f.email).success)
      issues.email = "Not a valid email";
  }
  if ((kind === "pan" || kind === "aadhaar") && f.dob && !/^\d{4}-\d{2}-\d{2}$/.test(f.dob))
    issues.dob = "Use YYYY-MM-DD";
  return { fields: f, issues };
}
