import dns from "node:dns/promises";
import net from "node:net";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return /^(fc|fd|fe[89ab]|ff)/.test(v);
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export class UnsafeUrlError extends Error {}

/**
 * Test-only escape hatch so end-to-end tests can post to a receiver on localhost. It is off unless
 * ALLOW_PRIVATE_WEBHOOKS=1 is set explicitly, and must never be set on a real deployment.
 */
const allowPrivate = () => process.env.ALLOW_PRIVATE_WEBHOOKS === "1";

/** Throws unless the URL is https (or http only in the dev escape hatch) and resolves to public IPs. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (allowPrivate()) return u;
  if (u.protocol !== "https:") throw new UnsafeUrlError("Only https URLs are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (addrs.length === 0 || addrs.some(isPrivateIp)) {
    throw new UnsafeUrlError("That address points to a private network and is blocked");
  }
  return u;
}

/** POST JSON to a user-supplied URL: SSRF-checked, no redirects, 8s timeout. */
export async function safePost(
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; ok: boolean }> {
  const u = await assertSafeUrl(url);
  const res = await fetch(u, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "user-agent": "PayFlow-Webhooks/1", ...headers },
    body,
  });
  return { status: res.status, ok: res.status >= 200 && res.status < 300 };
}
