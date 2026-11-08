import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateIp } from "./ssrf";
import { signatureHeaders, verifySignature } from "./signing";

describe("SSRF guard", () => {
  it("flags private and special addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.9",
      "172.16.5.5",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      "224.0.0.1",
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"])
      expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("rejects http, credentials, metadata and localhost URLs", async () => {
    await expect(assertSafeUrl("http://example.com/x")).rejects.toThrow(/https/);
    await expect(assertSafeUrl("https://user:pw@8.8.8.8/x")).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl("https://169.254.169.254/latest")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("https://[::1]/x")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("nope")).rejects.toThrow(/valid/);
    await expect(assertSafeUrl("https://8.8.8.8/hook")).resolves.toBeInstanceOf(URL);
  });
});

describe("webhook signatures", () => {
  it("verifies, and rejects tampering, wrong secret and stale timestamps", () => {
    const body = '{"a":1}';
    const h = signatureHeaders("s3cret", body, 1000);
    const t = h["x-payflow-timestamp"],
      s = h["x-payflow-signature"];
    expect(verifySignature("s3cret", body, t, s, 300, 1100)).toBe(true);
    expect(verifySignature("s3cret", '{"a":2}', t, s, 300, 1100)).toBe(false);
    expect(verifySignature("other", body, t, s, 300, 1100)).toBe(false);
    expect(verifySignature("s3cret", body, t, s, 300, 2000)).toBe(false);
    expect(verifySignature("s3cret", body, "abc", s)).toBe(false);
  });
});
