import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies a Razorpay webhook: HMAC-SHA256 of the exact raw body, constant-time compared. */
export function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
