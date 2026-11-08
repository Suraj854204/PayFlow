// Forgot / reset password flow in a real browser against the running app (default port 3100).
// Needs a migrated database with RLS, and E2E_DATABASE_URL (a table-owner connection) to read the
// reset token that would normally arrive by email. Needs `playwright` installed.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Pool } = require("pg");

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const pool = new Pool({
  connectionString: process.env.E2E_DATABASE_URL ?? "postgres://owner@localhost:54329/payflow_test",
});
const browser = await chromium.launch();
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (n) => console.log("PASS", n);
const fail = (n, extra = "") => {
  console.log("FAIL:", n, extra);
  process.exitCode = 1;
};
const must = (cond, name, extra) => (cond ? ok(name) : fail(name, extra));

const stamp = Date.now();
const EMAIL = `reset-${stamp}@pwtest.example`;
const OLD = "OldPassw0rd-x1";
const NEW = "BrandNewPass9-z";

const newCtx = async () => {
  const c = await browser.newContext();
  await c.addInitScript(() => {
    try {
      localStorage.setItem("payflow:tour:v1", "done");
    } catch {}
  });
  return c;
};
const pageOf = async (c) => {
  const p = await c.newPage();
  p.setDefaultTimeout(20000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) errors.push(m.text());
  });
  return p;
};
const api = (ctx, path, data) => ctx.request.post(BASE + path, { data, headers: { origin: BASE } });
const latestToken = async (email) => {
  const r = await pool.query(
    `select v.identifier from verification v join "user" u on u.id = v.value
      where u.email = $1 and v.identifier like 'reset-password:%' order by v.created_at desc limit 1`,
    [email],
  );
  return r.rows[0]?.identifier.replace("reset-password:", "");
};

try {
  // Account to reset, with a live session in context A (to check sessions are revoked).
  const A = await newCtx();
  const signup = await api(A, "/api/auth/sign-up/email", {
    name: "Reset Tester",
    email: EMAIL,
    password: OLD,
  });
  must(signup.ok(), "test account created", await signup.text());
  const pa = await pageOf(A);
  await pa.goto(BASE + "/onboarding");
  must(/onboarding/.test(pa.url()), "context A is signed in before the reset");

  // Login page has the link and it leads to the form.
  const B = await newCtx();
  const p = await pageOf(B);
  await p.goto(BASE + "/login");
  await p.click("text=Forgot password?");
  await p.waitForURL("**/forgot-password");
  must(
    (await p.locator("h1").innerText()).includes("Forgot"),
    "login links to the forgot-password page",
  );

  // Bad email is caught in the form; a real request shows the same confirmation.
  await p.fill("#email", "not-an-email");
  await p.click('button[type="submit"]');
  await p.waitForSelector("text=Enter a valid email");
  ok("invalid email rejected in the form");
  await p.fill("#email", EMAIL);
  await p.click('button[type="submit"]');
  await p.waitForSelector("text=a reset link is on its way");
  ok("existing account sees the neutral confirmation");

  // An unknown address gets the identical confirmation (no account enumeration).
  const p2 = await pageOf(await newCtx());
  await p2.goto(BASE + "/forgot-password");
  await p2.fill("#email", `nobody-${stamp}@pwtest.example`);
  await p2.click('button[type="submit"]');
  await p2.waitForSelector("text=a reset link is on its way");
  ok("unknown account sees the same confirmation");
  must(
    (
      await pool.query(
        `select count(*)::int n from verification where identifier like 'reset-password:%'`,
      )
    ).rows[0].n === 1,
    "only the real account got a token",
  );

  // The emailed link: valid token lands on the form.
  await sleep(300);
  const token = await latestToken(EMAIL);
  must(Boolean(token), "reset token stored for the account");
  const link = `${BASE}/api/auth/reset-password/${token}?callbackURL=%2Freset-password`;
  await p.goto(link);
  await p.waitForURL(/\/reset-password\?token=/);
  must(
    (await p.locator("h1").innerText()).includes("Choose a new password"),
    "valid link opens the new-password form",
  );

  // Form rules.
  await p.fill("#password", "short");
  await p.fill("#confirm", "short");
  await p.click('button[type="submit"]');
  await p.waitForSelector("text=Use at least 10 characters");
  ok("weak password refused in the form");
  await p.fill("#password", NEW);
  await p.fill("#confirm", NEW + "x");
  await p.click('button[type="submit"]');
  await p.waitForSelector("text=The two passwords do not match");
  ok("mismatched confirmation refused");

  // The server enforces the rules too, not only the form.
  const weak = await api(B, "/api/auth/reset-password", { newPassword: "alllowercase123", token });
  must(
    weak.status() === 400 && /uppercase/.test(await weak.text()),
    "server refuses a weak password",
    String(weak.status()),
  );
  const still = await latestToken(EMAIL);
  must(still === token, "a refused attempt does not burn the token");

  // Success.
  await p.fill("#password", NEW);
  await p.fill("#confirm", NEW);
  await p.click('button[type="submit"]');
  await p.waitForURL("**/login?reset=1");
  await p.waitForSelector("text=Password updated");
  ok("password changed and the login page confirms it");

  // The link works once only.
  await p.goto(link);
  await p.waitForSelector("text=This link does not work");
  ok("used link is rejected");
  await p.goto(`${BASE}/api/auth/reset-password/bogus-token?callbackURL=%2Freset-password`);
  await p.waitForSelector("text=This link does not work");
  ok("made-up token is rejected");
  await p.goto(BASE + "/reset-password");
  await p.waitForSelector("text=This link does not work");
  ok("reset page without a token is a friendly dead end");

  // Old password no longer works, new one does.
  await sleep(11000);
  const bad = await api(await newCtx(), "/api/auth/sign-in/email", { email: EMAIL, password: OLD });
  must(bad.status() === 401, "old password refused", String(bad.status()));
  await sleep(11000);
  const good = await api(await newCtx(), "/api/auth/sign-in/email", {
    email: EMAIL,
    password: NEW,
  });
  must(good.ok(), "new password signs in", String(good.status()));

  // Sessions from before the reset are signed out.
  await pa.waitForTimeout(500);
  await pa.goto(BASE + "/onboarding");
  const after = pa.url();
  must(/\/login/.test(after), "old session is signed out after the reset", after);

  // SSO-only companies cannot use password reset.
  await pool.query(
    `insert into organizations (name, slug, sso_domains) values ('SSO Co', $1, array['ssoco.test'])`,
    [`ssoco-${stamp}`],
  );
  const sso = await api(await newCtx(), "/api/auth/request-password-reset", {
    email: "x@ssoco.test",
    redirectTo: "/reset-password",
  });
  must(
    sso.status() === 403 && /single sign-on/.test(await sso.text()),
    "SSO-enforced domain cannot request a reset",
    String(sso.status()),
  );

  // Request limit: 3 per minute.
  await sleep(61000);
  const C = await newCtx();
  const codes = [];
  for (let i = 0; i < 5; i++)
    codes.push(
      (
        await api(C, "/api/auth/request-password-reset", {
          email: `rl${i}@pwtest.example`,
          redirectTo: "/reset-password",
        })
      ).status(),
    );
  must(
    codes.slice(0, 3).every((c) => c === 200) && codes.slice(3).every((c) => c === 429),
    "reset requests are rate limited",
    codes.join(","),
  );

  must(errors.length === 0, "no browser errors or CSP violations", errors.join(" | "));
} catch (e) {
  fail("script error", e.stack ?? String(e));
} finally {
  await browser.close();
  await pool.end();
  console.log(
    process.exitCode ? "PASSWORD RESET E2E FAILED" : "ALL PASSWORD RESET E2E CHECKS PASSED",
  );
}
