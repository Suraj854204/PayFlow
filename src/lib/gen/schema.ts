import { z } from "zod";
import { formatINR } from "@/lib/money";

export const GEN_KINDS = [
  "offer_letter",
  "appointment_letter",
  "job_description",
  "announcement_email",
] as const;
export type GenKind = (typeof GEN_KINDS)[number];
export const GEN_LABEL: Record<GenKind, string> = {
  offer_letter: "Offer letter",
  appointment_letter: "Appointment letter",
  job_description: "Job description",
  announcement_email: "Announcement email",
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const text = (max = 120) => z.string().trim().min(1, "Required").max(max);

export const INPUT_SCHEMAS = {
  offer_letter: z.object({
    candidateName: text(80),
    role: text(80),
    department: text(80),
    location: text(80),
    annualCtcRupees: z.number().positive().max(100_000_000),
    joiningDate: date,
    probationMonths: z.number().int().min(0).max(12).default(6),
    reportingTo: text(80).optional(),
  }),
  appointment_letter: z.object({
    employeeName: text(80),
    role: text(80),
    department: text(80),
    location: text(80),
    annualCtcRupees: z.number().positive().max(100_000_000),
    joiningDate: date,
    probationMonths: z.number().int().min(0).max(12).default(6),
    noticeDays: z.number().int().min(0).max(180).default(60),
  }),
  job_description: z.object({
    role: text(80),
    department: text(80),
    location: text(80),
    experience: text(40),
    skills: text(300),
    employmentType: z
      .enum(["Full-time", "Part-time", "Contract", "Internship"])
      .default("Full-time"),
  }),
  announcement_email: z.object({
    topic: text(120),
    details: text(800),
    audience: text(60).default("All employees"),
    tone: z.enum(["friendly", "formal", "urgent"]).default("friendly"),
  }),
} as const;

export type GenInputs = { [K in GenKind]: z.infer<(typeof INPUT_SCHEMAS)[K]> };
export interface Generated {
  subject: string;
  body: string;
}
export const generatedSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(40).max(6000),
});

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const inr = (rupees: number) => formatINR(Math.round(rupees * 100));

/** Facts the generated text must contain, so a model rewrite can be rejected if it drops or alters them. */
export function requiredFacts<K extends GenKind>(kind: K, i: GenInputs[K]): string[] {
  const a = i as Record<string, unknown>;
  switch (kind) {
    case "offer_letter":
    case "appointment_letter":
      return [
        String(a.candidateName ?? a.employeeName),
        inr(Number(a.annualCtcRupees)).replace(".00", ""),
        longDate(String(a.joiningDate)),
      ];
    case "job_description":
      return [String(a.role)];
    case "announcement_email":
      return [];
  }
}

/** Deterministic drafts. Used without an AI key, when the AI fails, and as the check for model output. */
export function renderTemplate<K extends GenKind>(
  kind: K,
  input: GenInputs[K],
  company: string,
): Generated {
  const i = input as Record<string, string | number>;
  const sign = `\n\nWarm regards,\nHuman Resources\n${company}`;
  switch (kind) {
    case "offer_letter":
      return {
        subject: `Offer of employment: ${i.role} at ${company}`,
        body: `Dear ${i.candidateName},\n\nWe are delighted to offer you the position of ${i.role} in the ${i.department} team at ${company}, based in ${i.location}${i.reportingTo ? `, reporting to ${i.reportingTo}` : ""}.\n\nYour annual cost to company (CTC) will be ${inr(Number(i.annualCtcRupees)).replace(".00", "")}, with the detailed break-up shared with your appointment letter. Your proposed date of joining is ${longDate(String(i.joiningDate))}.${Number(i.probationMonths) > 0 ? ` You will be on probation for ${i.probationMonths} months from your joining date.` : ""}\n\nThis offer is subject to satisfactory background and document verification. Please confirm your acceptance by replying to this email.\n\nWe look forward to welcoming you.${sign}`,
      };
    case "appointment_letter":
      return {
        subject: `Appointment letter: ${i.role}`,
        body: `Dear ${i.employeeName},\n\nFurther to your acceptance of our offer, we are pleased to appoint you as ${i.role} in the ${i.department} department at ${company}, ${i.location}, with effect from ${longDate(String(i.joiningDate))}.\n\n1. Compensation: your annual cost to company is ${inr(Number(i.annualCtcRupees)).replace(".00", "")}. Statutory deductions such as PF, Professional Tax and TDS apply as per law.\n2. Probation: ${Number(i.probationMonths) > 0 ? `${i.probationMonths} months from the date of joining.` : "None."}\n3. Notice period: ${i.noticeDays} days by either party after confirmation.\n4. Policies: you agree to follow the company's HR policies, code of conduct and confidentiality obligations as updated from time to time.\n\nPlease sign and return a copy of this letter to confirm your acceptance.${sign}`,
      };
    case "job_description":
      return {
        subject: `${i.role}, ${i.department} (${i.location})`,
        body: `${i.role}\n${i.department} · ${i.location} · ${i.employmentType}\n\nAbout the role\nWe are looking for a ${i.role} to join our ${i.department} team at ${company}. You will own your area end to end, work with colleagues across the company, and help us do the work well.\n\nWhat you will do\n- Take ownership of key ${i.department} responsibilities and deliver them reliably\n- Collaborate with teammates and stakeholders and communicate clearly\n- Improve how the team works, and share what you learn\n\nWhat we are looking for\n- Experience: ${i.experience}\n- Skills: ${i.skills}\n- Good judgement, curiosity and a habit of finishing what you start\n\nHow to apply\nSend your resume to HR at ${company} with the role title in the subject line.`,
      };
    case "announcement_email": {
      const open =
        i.tone === "urgent"
          ? "Important: please read"
          : i.tone === "formal"
            ? "Dear colleagues,"
            : "Hi everyone,";
      return {
        subject: `${i.tone === "urgent" ? "[Action needed] " : ""}${i.topic}`,
        body: `${open}\n\n${i.details}\n\nThis message is for: ${i.audience}.\n\nIf you have questions, please reply to this email or speak to HR.${sign}`,
      };
    }
  }
}
