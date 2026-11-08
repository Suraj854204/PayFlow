import { describe, expect, it } from "vitest";
import { FLAG_DEFS, isFlagKey, resolveFlags } from "./flags";
import { convertPaise, formatForeign, inrPerUnit } from "./fx";
import { emailDomain, parseDomains } from "./sso";
import { erasedEmail } from "@/lib/privacy/erasure";

describe("feature flags", () => {
  it("uses defaults when nothing is stored", () => {
    const f = resolveFlags([]);
    for (const d of FLAG_DEFS) expect(f[d.key]).toBe(d.defaultOn);
  });
  it("stored rows override defaults and unknown keys are ignored", () => {
    const f = resolveFlags([
      { key: "ewa", enabled: false },
      { key: "nonsense", enabled: true },
    ]);
    expect(f.ewa).toBe(false);
    expect("nonsense" in f).toBe(false);
    expect(isFlagKey("ewa")).toBe(true);
    expect(isFlagKey("nonsense")).toBe(false);
  });
});

describe("fx display", () => {
  it("converts paise to cents", () => {
    // 1 USD = 83.33 INR -> 0.012 USD per INR; Rs 1,00,000 = 10,000,000 paise
    expect(convertPaise(10_000_000, 0.012)).toBe(120_000);
    expect(formatForeign(120_000, "USD")).toBe("$1,200.00");
  });
  it("rejects bad rates", () => {
    expect(() => convertPaise(100, 0)).toThrow();
    expect(() => convertPaise(100, NaN)).toThrow();
  });
  it("inverts for display", () => {
    expect(inrPerUnit(0.0125)).toBeCloseTo(80, 6);
  });
});

describe("sso domains", () => {
  it("normalises, dedupes and flags invalid", () => {
    const r = parseDomains("@Acme.com, acme.com; sub.acme.in  not_a_domain");
    expect(r.domains).toEqual(["acme.com", "sub.acme.in"]);
    expect(r.invalid).toEqual(["not_a_domain"]);
  });
  it("extracts email domain", () => {
    expect(emailDomain(" Priya@Acme.COM ")).toBe("acme.com");
  });
});

describe("erasure", () => {
  it("placeholder email is unique per employee and undeliverable", () => {
    expect(erasedEmail("a")).not.toBe(erasedEmail("b"));
    expect(erasedEmail("a").endsWith(".invalid.payflow")).toBe(false);
    expect(erasedEmail("a")).toContain("@invalid.");
  });
});
