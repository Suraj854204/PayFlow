import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { buildCsp, newNonce } from "@/lib/csp";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/two-factor",
  "/invite",
  "/api/auth",
  "/api/health",
  "/api/webhooks",
  // Authenticated by their own credentials in the handler: API key, cron secret, Inngest signature.
  "/api/v1",
  "/api/cron",
  "/api/inngest",
  "/_next",
  "/icons",
];
const PUBLIC_EXACT = new Set([
  "/",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
  "/robots.txt",
  "/sitemap.xml",
]);

/**
 * First layer of access control: a fast cookie check at the edge. It only decides "is there a
 * session cookie?". It does not bounce signed-in people away from /login or /signup: a stale cookie
 * (revoked session) would then loop forever, so those pages check the real session themselves.
 * Real verification and RBAC happen on the server in getContext() and in every
 * server action / route handler, so this layer is never the only thing protecting data.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(getSessionCookie(req));

  const isPublic =
    PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isPublic && !hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Per-request nonce: Next reads it from the request's CSP header and stamps its own scripts.
  const nonce = newNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV !== "production" });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:js|png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)"],
};
