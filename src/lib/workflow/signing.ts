import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("hex")}`;

/** Stripe-style: signature over `${timestamp}.${body}` so a captured request cannot be replayed later. */
export function signPayload(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeaders(
  secret: string,
  body: string,
  now = Math.floor(Date.now() / 1000),
) {
  return {
    "x-payflow-timestamp": String(now),
    "x-payflow-signature": `v1=${signPayload(secret, body, now)}`,
  };
}

/** What a receiver runs. Exported so docs and tests use the exact same check. */
export function verifySignature(
  secret: string,
  body: string,
  timestamp: string,
  signature: string,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSec) return false;
  const expected = Buffer.from(`v1=${signPayload(secret, body, ts)}`);
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
