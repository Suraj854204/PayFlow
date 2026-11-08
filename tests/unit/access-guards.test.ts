/**
 * Structural safety net: every server action and API route must authenticate or verify a secret.
 * It cannot prove the checks are right (the integration and browser tests do that) but it fails the
 * build the moment someone adds an entry point with no check at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../src/app");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const ACTION_GUARD =
  /runAction\(|requireActionPermission\(|getSessionUser\(|requireContext\(|getContext\(|rateLimit\(/;
// Deliberately public: sets only the visitor's own language cookie.
const PUBLIC_ACTIONS = new Set(["setLocaleAction"]);

describe("server actions", () => {
  const files = walk(join(root, "actions")).filter((f) => f.endsWith(".ts"));
  it("found the action files", () => expect(files.length).toBeGreaterThan(20));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const parts = src.split(/^export async function /m).slice(1);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      if (PUBLIC_ACTIONS.has(name)) continue;
      it(`${f.split("/actions/")[1]} › ${name} checks who is calling`, () => {
        expect(part, `${name} has no authentication or permission check`).toMatch(ACTION_GUARD);
      });
    }
  }
  it("every actions file starts with 'use server'", () => {
    for (const f of files)
      expect(readFileSync(f, "utf8").trimStart().startsWith('"use server"')).toBe(true);
  });
});

const ROUTE_GUARD =
  /getContext\(|authenticate\(|CRON_SECRET|verifySignature\(|toNextJsHandler|serve\(/;
// health is for load balancers; openapi.json documents the public API and contains no tenant data.
const PUBLIC_ROUTES = ["api/health/route.ts", "api/v1/openapi.json/route.ts"];

describe("API routes", () => {
  const routes = walk(join(root, "api")).filter((f) => /route\.tsx?$/.test(f));
  it("found the routes", () => expect(routes.length).toBeGreaterThan(20));
  for (const f of routes) {
    const rel = f.split("/src/app/")[1];
    if (PUBLIC_ROUTES.includes(rel)) continue;
    it(`${rel} authenticates or verifies a secret`, () => {
      expect(readFileSync(f, "utf8"), rel).toMatch(ROUTE_GUARD);
    });
  }
  it("state-changing browser routes refuse other origins or sit behind SameSite cookies plus a guard", () => {
    // POST routes called from our own pages must not be drivable by a form on another site.
    for (const rel of ["api/paybot/route.ts"]) {
      expect(readFileSync(join(root, rel), "utf8")).toMatch(/origin/);
    }
  });
});

describe("pages", () => {
  it("the app layout requires a signed-in context", () => {
    expect(readFileSync(join(root, "(app)/layout.tsx"), "utf8")).toMatch(/requireContext\(/);
  });
  it("admin-only settings pages require a permission", () => {
    for (const p of ["settings/enterprise", "settings/company", "settings/roles"])
      expect(readFileSync(join(root, `(app)/${p}/page.tsx`), "utf8"), p).toMatch(
        /requirePagePermission\(|canAny\(/,
      );
  });
});
