import { describe, expect, it } from "vitest";
import { INPUT_SCHEMAS, renderTemplate, requiredFacts } from "./schema";

describe("generators", () => {
  const offer = INPUT_SCHEMAS.offer_letter.parse({
    candidateName: "Asha Rao",
    role: "Backend Engineer",
    department: "Engineering",
    location: "Bengaluru",
    annualCtcRupees: 1200000,
    joiningDate: "2026-12-01",
    probationMonths: 6,
  });
  it("renders an offer letter with every required fact", () => {
    const d = renderTemplate("offer_letter", offer, "Acme");
    for (const f of requiredFacts("offer_letter", offer)) expect(d.body).toContain(f);
    expect(d.body).toContain("₹12,00,000");
    expect(d.body).toContain("1 December 2026");
    expect(d.subject).toContain("Backend Engineer");
  });
  it("rejects invalid inputs", () => {
    expect(INPUT_SCHEMAS.offer_letter.safeParse({ ...offer, annualCtcRupees: -5 }).success).toBe(
      false,
    );
    expect(
      INPUT_SCHEMAS.offer_letter.safeParse({ ...offer, joiningDate: "tomorrow" }).success,
    ).toBe(false);
  });
  it("omits probation text when there is none and marks urgent announcements", () => {
    const d = renderTemplate("offer_letter", { ...offer, probationMonths: 0 }, "Acme");
    expect(d.body).not.toContain("probation");
    const a = renderTemplate(
      "announcement_email",
      INPUT_SCHEMAS.announcement_email.parse({
        topic: "Office closed",
        details: "The office is closed on Friday.",
        tone: "urgent",
      }),
      "Acme",
    );
    expect(a.subject).toMatch(/Action needed/);
  });
  it("covers appointment letters and job descriptions", () => {
    const ap = renderTemplate(
      "appointment_letter",
      INPUT_SCHEMAS.appointment_letter.parse({
        employeeName: "Ravi",
        role: "Analyst",
        department: "Finance",
        location: "Pune",
        annualCtcRupees: 900000,
        joiningDate: "2026-11-10",
      }),
      "Acme",
    );
    expect(ap.body).toContain("60 days");
    const jd = renderTemplate(
      "job_description",
      INPUT_SCHEMAS.job_description.parse({
        role: "Designer",
        department: "Product",
        location: "Remote",
        experience: "2-4 years",
        skills: "Figma, research",
      }),
      "Acme",
    );
    expect(jd.body).toContain("Figma, research");
  });
});
