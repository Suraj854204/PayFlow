/**
 * Content-Security-Policy with a per-request nonce. Scripts run only if they carry the nonce (Next
 * adds it to its own scripts when it sees the header on the request), so an injected <script> or
 * inline handler is blocked. `style-src 'unsafe-inline'` stays because component libraries set inline
 * styles; styles cannot run code. Images allow any https host only because a company can point its
 * white-label logo at its own domain.
 */
export function buildCsp({ nonce, dev }: { nonce: string; dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // The browser only talks to this origin: live notifications (SSE), server actions, PayBot.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export const newNonce = () => btoa(crypto.randomUUID());
