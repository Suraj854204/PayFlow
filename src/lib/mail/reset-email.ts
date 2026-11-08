import { sendMail } from "./send";

/** How long a reset link works. Must match `resetPasswordTokenExpiresIn` in the auth config. */
export const RESET_LINK_MINUTES = 60;

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function buildResetEmail(input: { name: string; url: string }) {
  const name = input.name.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "We received a request to reset your PayFlow password. Open this link to choose a new one:",
    input.url,
    "",
    `The link works for ${RESET_LINK_MINUTES} minutes and can be used once.`,
    "If you did not ask for this, ignore this email. Your password stays the same.",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>We received a request to reset your PayFlow password.</p>
<p><a href="${escapeHtml(input.url)}">Choose a new password</a></p>
<p>The link works for ${RESET_LINK_MINUTES} minutes and can be used once. If you did not ask for this, ignore this email. Your password stays the same.</p>`;
  return { subject: "Reset your PayFlow password", text, html };
}

/**
 * Emails the reset link. It never throws: a failure here must not change the response the visitor
 * sees (that would reveal whether an account exists). Without an email provider the link is printed
 * to the server log in development only; in production it is never logged.
 */
export async function deliverResetEmail(user: { email: string; name: string }, url: string) {
  const mail = buildResetEmail({ name: user.name, url });
  try {
    const result = await sendMail({ to: [user.email], ...mail });
    if (result.sent) return;
    if (process.env.NODE_ENV !== "production") {
      console.info(`[PayFlow] ${result.reason}. Password reset link for ${user.email}: ${url}`);
    } else {
      console.error(`[PayFlow] Password reset email not sent: ${result.reason}`);
    }
  } catch (err) {
    console.error(
      "[PayFlow] Password reset email failed",
      err instanceof Error ? err.message : err,
    );
  }
}
