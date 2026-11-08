import { describe, expect, it } from "vitest";
import { blindIndex, decrypt, encrypt, maskValue } from "./crypto";

describe("crypto (AES-256-GCM)", () => {
  it("round-trips plaintext", () => {
    const secret = "ABCDE1234F";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("uses a fresh IV so equal inputs encrypt differently", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("handles unicode and empty strings", () => {
    expect(decrypt(encrypt("₹ बैंक खाता"))).toBe("₹ बैंक खाता");
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("detects tampering with the ciphertext", () => {
    const parts = encrypt("1234567890").split(":");
    parts[3] = Buffer.from("tampered-data").toString("base64url");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decrypt("garbage")).toThrow("Invalid encrypted payload");
    expect(() => decrypt("v2:a:b:c")).toThrow("Invalid encrypted payload");
  });

  it("throws if the key is missing or malformed", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "short";
    expect(() => encrypt("x")).toThrow();
    process.env.ENCRYPTION_KEY = original;
  });

  it("blind index is deterministic and case/space insensitive", () => {
    expect(blindIndex("abcde1234f")).toBe(blindIndex(" ABCDE1234F "));
    expect(blindIndex("A")).not.toBe(blindIndex("B"));
  });

  it("masks all but the trailing characters", () => {
    expect(maskValue("123456789012")).toBe("********9012");
    expect(maskValue("12")).toBe("**");
  });
});
