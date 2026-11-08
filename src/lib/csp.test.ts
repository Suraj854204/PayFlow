import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  const prod = buildCsp({ nonce: "abc123", dev: false });
  it("lets only nonce-bearing scripts run in production", () => {
    const s = directive(prod, "script-src");
    expect(s).toContain("'nonce-abc123'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });
  it("locks down framing, plugins, base URL and form targets", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });
  it("only lets the browser call its own origin", () => {
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
  });
  it("dev adds eval and websockets for hot reload, nothing else", () => {
    const dev = buildCsp({ nonce: "n", dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
  it("nonces are unique and unguessable-looking", () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(a.length).toBeGreaterThan(30);
  });
});
