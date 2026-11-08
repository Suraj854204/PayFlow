export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export type MailResult = { sent: true } | { sent: false; reason: string };

/**
 * Sends through Resend's REST API. Without RESEND_API_KEY nothing is sent and the result says so,
 * so callers can decide what to do (workflow steps report it, password reset logs a dev link).
 * A provider error status throws.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "Email is not configured (RESEND_API_KEY)" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "PayFlow <noreply@payflow.local>",
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
  return { sent: true };
}
