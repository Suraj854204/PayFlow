import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature";

describe("webhook signature", () => {
  const body = '{"event":"payout.processed"}';
  const good = createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts a valid signature", () => expect(verifySignature(body, good, "s3cret")).toBe(true));
  it("rejects tampered body, wrong secret, missing header", () => {
    expect(verifySignature(body + " ", good, "s3cret")).toBe(false);
    expect(verifySignature(body, good, "other")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
    expect(verifySignature(body, "short", "s3cret")).toBe(false);
  });
});
