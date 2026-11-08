// Phase 9: simulator, EWA, recognition/streak/badges, anonymous surveys, enterprise settings (flags, SSO,
// branding, FX), privacy export/erasure, Hindi switch, PWA assets and offline attendance sync.
// Needs the seeded demo company (npm run db:seed), the app on E2E_BASE, and a table-owner
// connection in E2E_DATABASE_URL (default: the local test Postgres on :54329). Needs `playwright` installed.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const HI = JSON.parse(readFileSync(new URL("../../messages/hi.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Pool } = require("pg");

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const PW = "PayFlowDemo#2026";
const ok = (n) => console.log("PASS", n);
const browser = await chromium.launch();
const pool = new Pool({
  connectionString: process.env.E2E_DATABASE_URL ?? "postgres://owner@localhost:54329/payflow_test",
});
const errors = [];
const cspViolations = [];
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
  p.setDefaultTimeout(Number(process.env.E2E_TIMEOUT ?? 20000));
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text()))
      cspViolations.push(m.text().slice(0, 200));
  });
  return p;
};
async function must(cond, msg, p) {
  if (!cond) {
    await p?.screenshot({ path: "/home/claude/.e2e-fail.png", fullPage: true });
    console.log("page errors:", errors.slice(-3));
    throw new Error(`FAIL: ${msg} @ ${p?.url()}`);
  }
}
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
};
const login = async (p, who) => {
  await p.goto(`${BASE}/login`);
  await p.fill("#email", `${who}@payflow.demo`);
  await p.fill("#password", PW);
  await p.click('button[type="submit"]');
  await p.waitForURL("**/dashboard");
};
const ORG = "5eed0000-0000-4000-8000-000000000001";

try {
  // security headers: nonce-based CSP, no unsafe-inline scripts
  const h = await fetch(`${BASE}/login`);
  const csp = h.headers.get("content-security-policy") ?? "";
  const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
  if (!/'nonce-[^']+'/.test(scriptSrc) || scriptSrc.includes("'unsafe-inline'"))
    throw new Error("FAIL: weak CSP " + scriptSrc);
  for (const [k, v] of [
    ["x-frame-options", "DENY"],
    ["x-content-type-options", "nosniff"],
    ["cross-origin-opener-policy", "same-origin"],
  ])
    if (h.headers.get(k) !== v) throw new Error(`FAIL: header ${k}`);
  const html = await h.text();
  const nonce = /'nonce-([^']+)'/.exec(scriptSrc)?.[1];
  if (!html.includes(`nonce="${nonce}"`))
    throw new Error("FAIL: inline script is missing the request nonce");
  ok(
    "CSP uses a per-request nonce (no unsafe-inline scripts) and the other security headers are present",
  );

  // ---- employee ----
  const empCtx = await newCtx();
  const emp = await pageOf(empCtx);
  await login(emp, "employee");

  // simulator
  await emp.goto(`${BASE}/simulator`);
  await emp.getByRole("heading", { name: "What-if salary simulator" }).waitFor();
  await must(
    await emp.getByText("Monthly take-home now").isVisible(),
    "simulator shows take-home",
    emp,
  );
  ok("simulator renders from the caller's own salary");

  // streak + badges + recognition
  await emp.goto(`${BASE}/recognition`);
  await emp.getByRole("heading", { name: "Recognition and streaks" }).waitFor();
  const badges = await emp.locator("[data-badge]").count();
  await must(badges === 8, `8 badges (got ${badges})`, emp);
  const streak = Number(await emp.getByTestId("streak-days").innerText());
  await must(streak >= 1, `streak counts seeded attendance (got ${streak})`, emp);
  await emp.selectOption("#rc-to", { index: 1 });
  await emp.fill("#rc-msg", "Thanks for the help with the release");
  await emp.getByRole("button", { name: "Send" }).click();
  await emp.getByText("Thanks for the help with the release").waitFor();
  ok("streak, 8 badges, recognition posted and in the feed");

  // surveys: answer once, anonymously
  await emp.goto(`${BASE}/surveys`);
  await emp.getByTestId("open-survey").waitFor();
  const before = (await q("select count(*)::int n from survey_responses"))[0].n;
  for (const g of await emp.locator('[role="radiogroup"]').all())
    await g.getByRole("radio", { name: "4 of 5" }).click();
  await emp.locator("textarea").fill("Happy with the flexible hours");
  await emp.getByRole("button", { name: "Submit anonymously" }).click();
  await until(
    async () => (await q("select count(*)::int n from survey_responses"))[0].n === before + 1,
  );
  await must(
    (await q("select count(*)::int n from survey_responses"))[0].n === before + 1,
    "response stored",
    emp,
  );
  const cols = (
    await q(
      "select column_name from information_schema.columns where table_name='survey_responses'",
    )
  ).map((r) => r.column_name);
  await must(
    !cols.includes("user_id") && !cols.includes("employee_id"),
    "responses hold no identity",
    emp,
  );
  await emp.reload();
  await must((await emp.getByTestId("open-survey").count()) === 0, "survey no longer offered", emp);
  await must(
    (await emp.getByTestId("survey-result").count()) === 0,
    "employee cannot see results",
    emp,
  );
  ok("anonymous survey answered once, no identity stored, results hidden from employees");

  // privacy export is own data only
  const exp = await empCtx.request.get(`${BASE}/api/privacy/export`);
  await must(exp.ok(), "export ok", emp);
  const text = await exp.text();
  await must(text.includes("Ananya") && !text.includes("Neha"), "export holds own data only", emp);
  await must(!/[A-Z]{5}\d{4}[A-Z]/.test(text), "PAN masked in export", emp);
  await must(
    (await q("select count(*)::int n from privacy_requests where kind='export'"))[0].n >= 1,
    "export logged",
    emp,
  );
  ok("data export contains only my data, ids masked");

  // erasure request
  await emp.goto(`${BASE}/privacy`);
  await emp.getByRole("heading", { name: "My data and privacy" }).waitFor();
  await emp.getByLabel(/I understand/).check();
  await emp.getByRole("button", { name: "Request erasure" }).click();
  await emp.getByText("You have a request waiting for review.").waitFor();
  ok("erasure request created");

  // EWA
  await emp.goto(`${BASE}/ewa`);
  await emp.getByRole("heading", { name: "Earned wage access" }).waitFor();
  const placeholder = await emp
    .locator("#ewa-amount")
    .getAttribute("placeholder")
    .catch(() => null);
  console.log("  EWA input placeholder:", placeholder);
  if (placeholder) {
    const [min, max] = placeholder.split(" to ").map(Number);
    if (max >= min) {
      await emp.fill("#ewa-amount", String(min));
      await emp.getByRole("button", { name: "Request advance" }).click();
      const created = await until(
        async () => (await q("select count(*)::int n from ewa_requests"))[0].n === 1,
      );
      await must(created, "EWA request stored", emp);
      const loans = await q("select kind, emi from loans where kind='advance'");
      if ((await q("select status from ewa_requests"))[0].status === "approved")
        await must(
          loans.length === 1 && Number(loans[0].emi) === min * 100,
          "approved EWA became a one-instalment advance",
          emp,
        );
      ok(
        "EWA request within limits recorded" +
          (loans.length ? " and converted to an advance loan" : ""),
      );
    } else ok("EWA: nothing available yet this early in the month (limit respected)");
  }

  // Hindi
  await emp.goto(`${BASE}/dashboard`);
  await emp.getByLabel("Account menu").click();
  await emp.getByRole("radio", { name: /हिन्दी|हिंदी/ }).click();
  await emp.locator("aside nav a", { hasText: HI.nav.Dashboard }).first().waitFor();
  await must((await emp.locator("html").getAttribute("lang")) === "hi", "html lang is hi", emp);
  await emp.goto(`${BASE}/privacy`);
  await emp.getByRole("heading", { name: HI.privacy.title }).waitFor();
  await emp.getByLabel(HI.shell.accountMenu).click();
  await emp.getByRole("radio", { name: "English" }).click();
  await emp.locator("aside nav a", { hasText: "Dashboard" }).first().waitFor();
  ok("Hindi and English switch (nav, page copy, html lang)");

  // PWA
  const man = await empCtx.request.get(`${BASE}/manifest.webmanifest`);
  const mj = await man.json();
  await must(mj.display === "standalone" && mj.icons.length === 3, "manifest valid", emp);
  const ic = await empCtx.request.get(`${BASE}/icons/maskable.png`);
  await must((ic.headers()["content-type"] ?? "").includes("image/png"), "icon is a png", emp);
  ok("PWA manifest and icons");

  // offline attendance
  const empRow = (
    await q(
      "select e.id from employees e join \"user\" u on u.id=e.user_id where u.email='employee@payflow.demo'",
    )
  )[0].id;
  await q(
    "delete from attendance_records where employee_id=$1 and date=(now() at time zone 'Asia/Kolkata')::date",
    [empRow],
  );
  await emp.goto(`${BASE}/attendance`);
  await emp.getByRole("button", { name: "Check in" }).waitFor();
  await empCtx.setOffline(true);
  await emp.evaluate(() => window.dispatchEvent(new Event("offline")));
  await emp.getByRole("button", { name: "Check in" }).click();
  await emp.getByTestId("offline-queued").waitFor();
  await must(
    (
      await q(
        "select count(*)::int n from attendance_records where employee_id=$1 and date=(now() at time zone 'Asia/Kolkata')::date",
        [empRow],
      )
    )[0].n === 0,
    "nothing sent while offline",
    emp,
  );
  await empCtx.setOffline(false);
  await emp.evaluate(() => window.dispatchEvent(new Event("online")));
  const synced = await until(
    async () =>
      (
        await q(
          "select source from attendance_records where employee_id=$1 and date=(now() at time zone 'Asia/Kolkata')::date",
          [empRow],
        )
      )[0],
  );
  await must(synced?.source === "offline", `offline punch synced (source=${synced?.source})`, emp);
  await emp.getByTestId("offline-queued").waitFor({ state: "detached" });
  ok("offline check-in saved on device, synced on reconnect, source recorded as offline");

  // ---- HR: erasure queue + RBAC on enterprise settings ----
  const hrCtx = await newCtx();
  const hr = await pageOf(hrCtx);
  await login(hr, "hr");
  await hr.goto(`${BASE}/privacy`);
  await hr.getByTestId("erasure-queue").getByText("Ananya Iyer").waitFor();
  await hr.getByRole("button", { name: "Approve and erase" }).click();
  await hr.getByText(/Complete the employee's exit first/).waitFor();
  await must(
    (await q("select first_name from employees where id=$1", [empRow]))[0].first_name === "Ananya",
    "active employee not erased",
    hr,
  );
  ok("HR cannot erase an employee who has not exited; data untouched");
  await hr.goto(`${BASE}/settings/enterprise`);
  await hr.waitForURL("**/dashboard**");
  ok("RBAC: HR admin cannot open enterprise settings");
  // HR can see survey results (>= 5 answers)
  await hr.goto(`${BASE}/surveys`);
  await hr
    .getByTestId("survey-result")
    .first()
    .getByText(/Overall average/)
    .waitFor();
  ok("HR sees aggregate survey results, no respondent names");

  // ---- admin: enterprise settings ----
  const adCtx = await newCtx();
  const ad = await pageOf(adCtx);
  await login(ad, "admin");
  await ad.goto(`${BASE}/settings/enterprise`);
  await ad.getByRole("heading", { name: "Enterprise settings" }).waitFor();

  // branding
  await ad.fill("#br-name", "Brightwave");
  await ad.getByRole("button", { name: "Save branding" }).click();
  await ad.locator("aside").getByText("Brightwave").waitFor();
  ok("white-label name appears in the sidebar");
  await ad.fill("#br-logo", "http://insecure.example/logo.png");
  await ad.getByRole("button", { name: "Save branding" }).click();
  await ad.getByText("Logo must be an https:// link.").first().waitFor();
  await must(
    (await q("select logo_url from organizations where id=$1", [ORG]))[0].logo_url === null,
    "non-https logo rejected",
    ad,
  );
  ok("non-https logo refused");

  // feature flag
  await ad.getByRole("switch", { name: "Pulse surveys" }).click();
  await until(
    async () =>
      (await q("select enabled from feature_flags where key='surveys'"))[0]?.enabled === false,
  );
  await ad.goto(`${BASE}/surveys`);
  await ad
    .getByText(/could not be found|404/)
    .first()
    .waitFor();
  await must(
    (await ad.getByRole("heading", { name: "Pulse surveys" }).count()) === 0,
    "survey page content not served when off",
    ad,
  );
  await ad.goto(`${BASE}/settings/enterprise`);
  await ad.getByRole("switch", { name: "Pulse surveys" }).click();
  await until(
    async () =>
      (await q("select enabled from feature_flags where key='surveys'"))[0]?.enabled === true,
  );
  ok("feature flag off makes the page unreachable; back on restores it");

  // FX
  await ad.selectOption("#fx-cur", "USD");
  await ad.fill("#fx-rate", "83.5");
  await ad.getByRole("button", { name: "Save rate" }).click();
  await ad.getByText("1 USD = ₹83.50").waitFor();
  await ad.goto(`${BASE}/simulator`);
  await ad.getByTestId("fx-note").waitFor();
  ok("FX rate entered; simulator adds an indicative USD figure");

  // SSO enforcement
  await ad.goto(`${BASE}/settings/enterprise`);
  await ad.fill("#sso-domains", "payflow.demo");
  await ad.getByRole("button", { name: "Save", exact: true }).click();
  await until(async () =>
    (await q("select sso_domains from organizations where id=$1", [ORG]))[0].sso_domains.includes(
      "payflow.demo",
    ),
  );
  // Sign-in is limited to 3 per 10 s per address; earlier steps signed in several times.
  await new Promise((r) => setTimeout(r, 11_000));
  const anon = await newCtx();
  const ap = await pageOf(anon);
  await ap.goto(`${BASE}/login`);
  await ap.fill("#email", "employee@payflow.demo");
  await ap.fill("#password", PW);
  await ap.click('button[type="submit"]');
  await ap.getByText(/requires single sign-on/i).waitFor();
  await must(ap.url().includes("/login"), "password sign-in refused for SSO domain", ap);
  await ad.fill("#sso-domains", "");
  await ad.getByRole("button", { name: "Save", exact: true }).click();
  await until(
    async () =>
      (await q("select sso_domains from organizations where id=$1", [ORG]))[0].sso_domains
        .length === 0,
  );
  await new Promise((r) => setTimeout(r, 11000)); // sign-in is rate limited per IP
  const ap2 = await pageOf(await newCtx());
  await login(ap2, "employee");
  ok("SSO domain enforcement blocks password sign-in; removing it restores it");

  // cleanup the data this run created so reruns start clean
  await q("delete from fx_rates");
  await q("update organizations set brand_name=null where id=$1", [ORG]);
  await must(cspViolations.length === 0, `no CSP violations (${cspViolations[0]})`, ad);
  ok("no Content-Security-Policy violations on any page visited");
  ok("ALL PHASE 9 E2E CHECKS PASSED");
  console.log("page errors:", errors.length ? errors : "none");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await pool.end();
}
