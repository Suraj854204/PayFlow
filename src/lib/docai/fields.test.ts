import { describe, expect, it } from "vitest";
import { validateFields, verhoeff } from "./fields";

describe("verhoeff", () => {
  it("accepts a number with a valid checksum and rejects a changed digit", () => {
    // Wikipedia's worked example: the check digit for 236 is 3.
    expect(verhoeff("2363")).toBe(true);
    expect(verhoeff("2364")).toBe(false);
  });
});

describe("validateFields", () => {
  it("normalises and validates a PAN", () => {
    const r = validateFields("pan", { pan: " abcde1234f ", name: "A" });
    expect(r.fields.pan).toBe("ABCDE1234F");
    expect(r.issues).toEqual({});
    expect(validateFields("pan", { pan: "12345" }).issues.pan).toMatch(/looks like/);
  });
  it("requires an Aadhaar with a valid checksum", () => {
    expect(validateFields("aadhaar", { aadhaar: "2345 6789 0123" }).issues.aadhaar).toBeDefined();
  });
  it("checks bank account and IFSC", () => {
    expect(
      validateFields("bank_proof", { accountNumber: "123456789012", ifsc: "hdfc0001234" }).issues,
    ).toEqual({});
    const bad = validateFields("bank_proof", { accountNumber: "12", ifsc: "X" }).issues;
    expect(Object.keys(bad).sort()).toEqual(["accountNumber", "ifsc"]);
  });
  it("only needs a name for a resume and checks the email", () => {
    expect(validateFields("resume", { name: "Asha Rao" }).issues).toEqual({});
    expect(
      validateFields("resume", { name: "Asha Rao", email: "nope" }).issues.email,
    ).toBeDefined();
  });
});
