import { z } from "zod";

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const AADHAAR_RE = /^[2-9][0-9]{11}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^[0-9]{9,18}$/;

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a real date");

export const optionalDate = z
  .union([isoDate, z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalPan = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || PAN_RE.test(v), "PAN looks like ABCDE1234F");

const optionalAadhaar = z
  .string()
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, "") : undefined))
  .refine((v) => v === undefined || AADHAAR_RE.test(v), "Aadhaar must be 12 digits");

const optionalIfsc = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || IFSC_RE.test(v), "IFSC looks like HDFC0001234");

const optionalAccount = z
  .string()
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, "") : undefined))
  .refine((v) => v === undefined || ACCOUNT_RE.test(v), "Account number must be 9 to 18 digits");

export const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1, "Required").max(30),
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().max(80).default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: optionalText(20),
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: optionalDate,
  joinDate: isoDate,
  probationEndDate: optionalDate,
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  workState: optionalText(60),
  taxRegime: z.enum(["new", "old"]).default("new"),
  pan: optionalPan,
  aadhaar: optionalAadhaar,
  bankAccount: optionalAccount,
  bankIfsc: optionalIfsc,
  bankName: optionalText(80),
  uan: optionalText(20),
  esiNumber: optionalText(20),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const uuid = z.string().uuid();

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

/** National holidays that fall on fixed dates every year. Regional ones vary and are added by HR. */
export const NATIONAL_HOLIDAYS: { name: string; month: number; day: number }[] = [
  { name: "Republic Day", month: 1, day: 26 },
  { name: "Independence Day", month: 8, day: 15 },
  { name: "Gandhi Jayanti", month: 10, day: 2 },
  { name: "Christmas", month: 12, day: 25 },
];

export const DEFAULT_ONBOARDING = [
  "Collect signed offer letter",
  "Collect PAN and Aadhaar",
  "Collect bank account proof",
  "Create company email account",
  "Assign laptop and equipment",
  "Add to payroll and salary structure",
  "Welcome email and team introduction",
];

export const DEFAULT_OFFBOARDING = [
  "Accept resignation and confirm last working day",
  "Knowledge transfer completed",
  "Return laptop and equipment",
  "Revoke system access",
  "Exit interview",
  "Full and final settlement prepared",
  "Issue experience and relieving letters",
];

/** Prefix cells that spreadsheets would execute as formulas, so exported CSVs are safe to open. */
export function csvSafe(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
