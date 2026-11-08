import "server-only";
import { env } from "@/lib/env";

export interface PayoutRequest {
  /** Our unique key; the provider must treat repeats as the same payout. */
  idempotencyKey: string;
  amountPaise: number;
  name: string;
  email: string;
  accountNumber: string;
  ifsc: string;
  narration: string;
}

export type PayoutOutcome =
  | { status: "processing" | "processed"; providerRef: string }
  | { status: "failed"; reason: string };

export interface PayoutProvider {
  name: "simulated" | "razorpay";
  payout(req: PayoutRequest): Promise<PayoutOutcome>;
}

/**
 * Test-mode provider used when no Razorpay keys are configured. It validates the destination like a
 * bank would and succeeds immediately, so the whole payroll flow can be exercised end to end.
 */
export const simulatedProvider: PayoutProvider = {
  name: "simulated",
  async payout(req) {
    if (!/^[0-9]{9,18}$/.test(req.accountNumber))
      return { status: "failed", reason: "Invalid bank account number" };
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(req.ifsc))
      return { status: "failed", reason: "Invalid IFSC code" };
    return {
      status: "processed",
      providerRef: `sim_${req.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
    };
  },
};

/**
 * RazorpayX payouts (contact -> fund account -> payout). NOTE: written against Razorpay's public API
 * documentation but not exercised against a live Razorpay account in this repository's tests.
 * Verify in Razorpay test mode with your keys before relying on it.
 */
function razorpayProvider(keyId: string, secret: string, account: string): PayoutProvider {
  const auth = `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`;
  const call = async (path: string, body: unknown, idem?: string) => {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth,
        ...(idem ? { "X-Payout-Idempotency": idem } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { description?: string };
    };
    if (!res.ok) throw new Error(json?.error?.description ?? `Razorpay error ${res.status}`);
    return json;
  };
  return {
    name: "razorpay",
    async payout(req) {
      try {
        const contact = await call("/contacts", {
          name: req.name,
          email: req.email,
          type: "employee",
          reference_id: req.idempotencyKey.slice(0, 40),
        });
        const fund = await call("/fund_accounts", {
          contact_id: contact.id,
          account_type: "bank_account",
          bank_account: { name: req.name, ifsc: req.ifsc, account_number: req.accountNumber },
        });
        const payout = await call(
          "/payouts",
          {
            account_number: account,
            fund_account_id: fund.id,
            amount: req.amountPaise,
            currency: "INR",
            mode: "NEFT",
            purpose: "salary",
            queue_if_low_balance: false,
            reference_id: req.idempotencyKey.slice(0, 40),
            narration: req.narration.slice(0, 30),
          },
          req.idempotencyKey,
        );
        const status = payout.status === "processed" ? "processed" : "processing";
        return { status, providerRef: String(payout.id) };
      } catch (e) {
        return { status: "failed", reason: e instanceof Error ? e.message : "Payout failed" };
      }
    },
  };
}

export function getProvider(): PayoutProvider {
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAYX_ACCOUNT_NUMBER) {
    return razorpayProvider(
      env.RAZORPAY_KEY_ID,
      env.RAZORPAY_KEY_SECRET,
      env.RAZORPAYX_ACCOUNT_NUMBER,
    );
  }
  return simulatedProvider;
}
