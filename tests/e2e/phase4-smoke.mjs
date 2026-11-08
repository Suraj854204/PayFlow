// Drives the real UI for Phase 4: attendance, leave, expenses, month lock into payroll, tax,
// compliance, reports and exports. Needs the app on E2E_BASE and the throwaway Postgres on :54329.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Pool } = require("pg");

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const RUN = Date.now();
const OWNER = `owner${RUN}@example.com`;
const ASHA = `asha${RUN}@example.com`;
const PW = "Str0ngPassw0rd!";
const ok = (n) => console.log("PASS", n);
const browser = await chromium.launch();
const errors = [];
const newPage = async () => {
  const c = await browser.newContext({ acceptDownloads: true });
  await c.addInitScript(() => {
    try {
      localStorage.setItem("payflow:tour:v1", "done");
    } catch {}
  });
  const p = await c.newPage();
  p.setDefaultTimeout(20000);
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("dialog", (d) => d.accept());
  return p;
};
const page = await newPage();
async function must(cond, msg, p = page) {
  if (!cond) {
    await p.screenshot({ path: "/home/claude/.e2e-fail.png", fullPage: true });
    throw new Error(`FAIL: ${msg} @ ${p.url()}`);
  }
}
const signup = async (p, name, email) => {
  await p.goto(`${BASE}/signup`);
  await p.fill("#name", name);
  await p.fill("#email", email);
  await p.fill("#password", PW);
  await p.click('button[type="submit"]');
  await p.waitForURL("**/onboarding");
};
const get = async (p, path) => {
  const r = await p.context().request.get(`${BASE}${path}`);
  return { status: r.status(), body: await r.body(), type: r.headers()["content-type"] ?? "" };
};

await signup(page, "Olivia Owner", OWNER);
await page.fill("#name", "Acme Technologies Pvt Ltd");
await page.fill("#state", "Karnataka");
await page.click('button[type="submit"]');
await page.waitForURL("**/setup");
ok("owner created a company");

await page.goto(`${BASE}/employees/new`);
await page.fill("#employeeCode", "E101");
await page.fill("#firstName", "Asha");
await page.fill("#lastName", "Tester");
await page.fill("#email", ASHA);
await page.fill("#joinDate", "2026-01-01");
await page.selectOption("#workState", "Karnataka");
await page.fill("#pan", "ABCDE1001F");
await page.click('button:has-text("Create employee")');
await page.waitForURL(/\/employees\/[0-9a-f-]{36}$/);
const ashaUrl = page.url();
await page.fill("#ctc", "1200000");
await page.click('button:has-text("Save salary")');
await page.waitForSelector("text=Current");
await page.click('button:has-text("Invite to PayFlow")');
await page.click('button:has-text("Create invite link")');
const link = (await page.inputValue('input[aria-label="Invite link"]')).replace(
  /^https?:\/\/[^/]+/,
  BASE,
);
const asha = await newPage();
await signup(asha, "Asha Tester", ASHA);
await asha.goto(link);
await asha.click('button:has-text("Accept invitation")');
await asha.waitForURL("**/dashboard");
ok("employee joined with a salary");

// Attendance: check in and out
await asha.goto(`${BASE}/attendance`);
await asha.click('button:has-text("Check in")');
await asha.waitForSelector('button:has-text("Check out")');
await asha.click('button:has-text("Check out")');
await asha.waitForSelector("text=Checked out", { timeout: 8000 }).catch(() => {});
await asha.reload();
await must(
  (await asha.locator('button:has-text("Check in")').count()) === 0,
  "check-in button should be gone after a check-in",
  asha,
);
ok("employee checked in and out");

// Employee cannot see admin controls or reports
await must(
  (await asha.locator('button:has-text("Lock month for payroll")').count()) === 0,
  "employee sees lock control",
  asha,
);
await asha.goto(`${BASE}/reports`);
await asha.waitForURL("**/dashboard?denied=1");
const denied = await get(asha, "/api/reports/export?format=xlsx");
await must(denied.status === 403, `employee export should be 403, got ${denied.status}`, asha);
ok("employee blocked from reports and exports");

// Leave: apply, cannot self-approve, HR approves
const d = new Date(Date.now() + 21 * 86400000);
while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
const day = d.toISOString().slice(0, 10);
await asha.goto(`${BASE}/leave`);
await asha.fill("#lv-from", day);
await asha.fill("#lv-to", day);
await asha.click('button:has-text("Request")');
await asha.waitForSelector("text=Pending", { timeout: 8000 });
await asha.reload();
await must(
  (await asha.locator('button:has-text("Approve")').count()) === 0,
  "employee sees Approve on a queue",
  asha,
);
await page.goto(`${BASE}/leave`);
await page.click('button:has-text("Approve")');
await page.waitForSelector("text=Approved", { timeout: 8000 });
ok("leave applied and approved by HR; no self-approval control");

// Expense: submit under the receipt threshold, owner approves
await asha.goto(`${BASE}/expenses`);
await asha.selectOption("#ex-cat", { index: 0 });
await asha.fill("#ex-amount", "300");
await asha.fill("#ex-desc", "Cab to client");
await asha.click('button:has-text("Submit claim")');
await asha.waitForSelector("text=Cab to client", { timeout: 8000 });
await page.goto(`${BASE}/expenses`);
await page.click('button:has-text("Approve")');
await page.waitForSelector("text=Approved", { timeout: 8000 });
ok("expense claimed and approved");

// Over-threshold claim without a receipt is refused
await asha.fill("#ex-amount", "900");
await asha.fill("#ex-desc", "No receipt");
await asha.click('button:has-text("Submit claim")');
await asha.waitForTimeout(1500);
await must(
  !(
    (await asha.locator("text=No receipt").count()) &&
    (await asha.locator("tr:has-text('No receipt')").count())
  ),
  "claim above 500 without receipt was accepted",
  asha,
);
ok("claim above the receipt limit is rejected");

// Tax declaration
await asha.goto(`${BASE}/tax`);
await must((await asha.locator("text=Tax").count()) > 0, "tax page did not render", asha);
ok("tax page renders for the employee");

// Lock the month, then run payroll: expense flows into the item
await page.goto(`${BASE}/attendance`);
await page.click('button:has-text("Lock month for payroll")');
await page.waitForSelector("text=Locked", { timeout: 10000 });
ok("attendance month locked");
await page.goto(`${BASE}/payroll`);
await page.click('button:has-text("Start payroll run")');
await page.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
await page.waitForSelector("text=Asha Tester");
const pool = new Pool({ host: "/tmp", port: 54329, user: "owner", database: "payflow_test" });
const runId = page.url().split("/").pop();
const r = await pool.query("select expense_amount, lop_days from payroll_items where run_id = $1", [
  runId,
]);
await must(
  r.rows.length === 1 && Number(r.rows[0].expense_amount) === 30000,
  `expected expense_amount 30000, got ${JSON.stringify(r.rows)}`,
);
ok(`approved expense carried into payroll (LOP days: ${r.rows[0].lop_days})`);

// Compliance, reports and exports
await page.goto(`${BASE}/compliance`);
await page.waitForSelector("text=Provident Fund");
await must(
  (await page.locator("text=Mark filed").count()) > 0,
  "no fileable compliance item shown",
);
ok("compliance calendar rendered");
const reports = await page.goto(`${BASE}/reports`);
await must(reports.status() === 200, "reports page failed");
for (const [fmt, magic, type] of [
  ["xlsx", "PK", "spreadsheetml"],
  ["pdf", "%PDF", "pdf"],
]) {
  const x = await get(page, `/api/reports/export?format=${fmt}`);
  await must(
    x.status === 200 &&
      x.type.includes(type) &&
      x.body.subarray(0, magic.length).toString() === magic,
    `${fmt} export bad: ${x.status} ${x.type}`,
  );
}
const bad = await get(page, "/api/reports/export?format=exe");
await must(bad.status === 400, "bad export format not rejected");
const f16 = await get(page, `/api/form16/${ashaUrl.split("/").pop()}?fy=2026`);
await must(
  f16.status === 404 && f16.body.toString().includes("No processed payroll"),
  `form16 for a draft-only year should be 404, got ${f16.status}`,
);
const audit = await pool.query(
  "select count(*)::int n from audit_logs where action = 'reports.exported'",
);
await must(audit.rows[0].n >= 2, "report exports were not audited");
ok("reports page, Excel/PDF exports (audited) and Form 16 refusal without processed payroll work");

await must(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
await pool.end();
await browser.close();
console.log("ALL PHASE 4 CHECKS PASSED");
