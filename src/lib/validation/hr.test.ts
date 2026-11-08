import { describe, expect, it } from "vitest";
import { csvSafe, employeeSchema } from "./hr";

const base = {
  employeeCode: "E001",
  firstName: "Asha",
  email: "Asha@Acme.in",
  joinDate: "2026-04-01",
};

describe("employeeSchema", () => {
  it("accepts a minimal employee and normalises email", () => {
    const r = employeeSchema.parse(base);
    expect(r.email).toBe("asha@acme.in");
    expect(r.employmentType).toBe("full_time");
    expect(r.lastName).toBe("");
  });

  it("validates PAN, Aadhaar, IFSC and account formats", () => {
    expect(employeeSchema.safeParse({ ...base, pan: "abcde1234f" }).success).toBe(true);
    expect(employeeSchema.parse({ ...base, pan: "abcde1234f" }).pan).toBe("ABCDE1234F");
    expect(employeeSchema.safeParse({ ...base, pan: "ABCDE12345" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...base, aadhaar: "2345 6789 0123" }).success).toBe(true);
    expect(employeeSchema.safeParse({ ...base, aadhaar: "0123 4567 8901" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...base, bankIfsc: "hdfc0001234" }).success).toBe(true);
    expect(employeeSchema.safeParse({ ...base, bankIfsc: "HDFC1001234" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...base, bankAccount: "12345678" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...base, bankAccount: "123456789012" }).success).toBe(true);
  });

  it("treats blank optional fields as absent", () => {
    const r = employeeSchema.parse({ ...base, pan: "", phone: "", dateOfBirth: "" });
    expect(r.pan).toBeUndefined();
    expect(r.phone).toBeUndefined();
    expect(r.dateOfBirth).toBeUndefined();
  });

  it("rejects impossible dates", () => {
    expect(employeeSchema.safeParse({ ...base, joinDate: "2026-02-30" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...base, joinDate: "01/04/2026" }).success).toBe(false);
  });
});

describe("csvSafe", () => {
  it("neutralises formula injection", () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvSafe("+1")).toBe("'+1");
    expect(csvSafe("@cmd")).toBe("'@cmd");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvSafe("a,b")).toBe('"a,b"');
    expect(csvSafe('say "hi"')).toBe('"say ""hi"""');
    expect(csvSafe("a\nb")).toBe('"a\nb"');
  });
  it("handles null and plain values", () => {
    expect(csvSafe(null)).toBe("");
    expect(csvSafe(42)).toBe("42");
    expect(csvSafe("plain")).toBe("plain");
  });
});
