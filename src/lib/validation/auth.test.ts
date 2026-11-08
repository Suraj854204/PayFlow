import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  loginSchema,
  passwordStrengthError,
  resetPasswordSchema,
  signupSchema,
  totpSchema,
} from "./auth";

describe("auth validation", () => {
  it("normalises email on login", () => {
    expect(loginSchema.parse({ email: "  Ravi@Acme.IN ", password: "x" }).email).toBe(
      "ravi@acme.in",
    );
  });

  it("enforces password strength on signup", () => {
    const base = { name: "Ravi Kumar", email: "ravi@acme.in" };
    expect(signupSchema.safeParse({ ...base, password: "short1A" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "alllowercase123" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "NOLOWERCASE123" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "NoDigitsHereAtAll" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "GoodPassw0rd!" }).success).toBe(true);
  });

  it("requires a 6-digit TOTP code", () => {
    expect(totpSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(totpSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(totpSchema.safeParse({ code: "12345a" }).success).toBe(false);
  });
});

describe("password reset validation", () => {
  it("accepts a strong password that matches its confirmation", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "Sturdy-pass9", confirm: "Sturdy-pass9" }).success,
    ).toBe(true);
  });

  it("rejects a mismatch on the confirm field", () => {
    const r = resetPasswordSchema.safeParse({ password: "Sturdy-pass9", confirm: "Sturdy-pass8" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["confirm"]);
  });

  it("reports the first rule a weak password breaks", () => {
    expect(passwordStrengthError("short1A")).toMatch(/10 characters/);
    expect(passwordStrengthError("alllowercase123")).toMatch(/uppercase/);
    expect(passwordStrengthError("ALLUPPERCASE123")).toMatch(/lowercase/);
    expect(passwordStrengthError("NoDigitsHereAtAll")).toMatch(/number/);
    expect(passwordStrengthError("Sturdy-pass9")).toBeNull();
  });

  it("normalises the email on the forgot form", () => {
    expect(forgotPasswordSchema.parse({ email: "  Asha@Example.COM " }).email).toBe(
      "asha@example.com",
    );
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
