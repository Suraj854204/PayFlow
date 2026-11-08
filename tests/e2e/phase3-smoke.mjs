// Drives the real UI for Phase 3: payroll run, maker-checker, payments (fail + retry), payslips,
// bank file, webhook, audit. Needs the app on E2E_BASE and the throwaway Postgres on :54329.
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Pool } = require("pg");

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const SECRET = process.env.E2E_WEBHOOK_SECRET ?? "whsec_test_123";
const RUN = Date.now();
const OWNER = `owner${RUN}@example.com`;
const ASHA = `asha${RUN}@example.com`;
const FIONA = `fiona${RUN}@example.com`; // finance; also employee Ravi (no bank yet)
const PW = "Str0ngPassw0rd!";
const steps = [];
const ok = (n) => (steps.push(n), console.log("PASS", n));

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
  return p;
};
const page = await newPage();
async function must(cond, msg, p = page) {
  if (!cond) {
    await p.screenshot({ path: "/home/claude/.e2e-fail.png" });
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

// Owner + company
await signup(page, "Olivia Owner", OWNER);
await page.fill("#name", "Acme Technologies Pvt Ltd");
await page.fill("#state", "Karnataka");
await page.click('button[type="submit"]');
await page.waitForURL("**/setup");
ok("owner signed up and created a company");

async function addEmployee(code, first, email, { bank } = {}) {
  await page.goto(`${BASE}/employees/new`);
  await page.fill("#employeeCode", code);
  await page.fill("#firstName", first);
  await page.fill("#lastName", "Tester");
  await page.fill("#email", email);
  await page.fill("#joinDate", "2026-01-01");
  await page.selectOption("#workState", "Karnataka");
  await page.fill("#pan", "ABCDE1234F".replace("E1234", `E${1000 + (code === "E101" ? 1 : 2)}`));
  if (bank) {
    await page.fill("#bankAccount", bank);
    await page.fill("#bankIfsc", "HDFC0001234");
  }
  await page.click('button:has-text("Create employee")');
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}$/);
  return page.url();
}
const ashaUrl = await addEmployee("E101", "Asha", ASHA, { bank: "123456789012" });
const ravi = await addEmployee("E102", "Ravi", FIONA);
for (const [url, ctc] of [
  [ashaUrl, "1200000"],
  [ravi, "600000"],
]) {
  await page.goto(url);
  await page.fill("#ctc", ctc);
  await page.click('button:has-text("Save salary")');
  await page.waitForSelector("text=Current");
}
ok("two employees created with salaries (one without bank details)");

// Invite both so Asha (employee) and Fiona (will become Finance) have logins
async function invite(url) {
  await page.goto(url);
  await page.click('button:has-text("Invite to PayFlow")');
  await page.click('button:has-text("Create invite link")');
  const l = await page.inputValue('input[aria-label="Invite link"]');
  return l.replace(/^https?:\/\/[^/]+/, BASE);
}
const ashaLink = await invite(ashaUrl);
const fionaLink = await invite(ravi);
const asha = await newPage();
await signup(asha, "Asha Tester", ASHA);
await asha.goto(ashaLink);
await asha.click('button:has-text("Accept invitation")');
await asha.waitForURL("**/dashboard");
const fiona = await newPage();
await signup(fiona, "Fiona Finance", FIONA);
await fiona.goto(fionaLink);
await fiona.click('button:has-text("Accept invitation")');
await fiona.waitForURL("**/dashboard");
// Test setup only: the UI has no role editor yet, so promote Fiona to Finance in the database.
const pool = new Pool({ host: "/tmp", port: 54329, user: "owner", database: "payflow_test" });
{
  const c = await pool.connect();
  try {
    await c.query("begin");
    const u = await c.query('select id from "user" where email = $1', [FIONA]);
    await c.query("select set_config('app.current_user', $1, true)", [u.rows[0].id]);
    const r = await c.query("update memberships set role = 'finance' where user_id = $1", [
      u.rows[0].id,
    ]);
    if (r.rowCount !== 1) throw new Error("could not promote finance user");
    await c.query("commit");
  } finally {
    c.release();
  }
}
ok("employee and finance users joined via invites");

// Employee cannot reach payroll
await asha.goto(`${BASE}/payroll`);
await asha.waitForURL("**/dashboard?denied=1");
ok("employee blocked from payroll");

// Owner creates the run and edits Asha's inputs
await page.goto(`${BASE}/payroll`);
await page.click('button:has-text("Start payroll run")');
await page.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
const runUrl = page.url();
const runId = runUrl.split("/").pop();
await page.waitForSelector("text=Asha Tester");
ok("draft run created for the current month");

await page.click('tr:has-text("Asha Tester") button:has-text("Edit")');
await page.fill('input[id$="-bonus"]', "10000");
await page.click('button:has-text("Save and recalculate")');
await page.waitForSelector("text=₹1,06,800.00", { timeout: 8000 }).catch(async (e) => {
  await page.screenshot({ path: "/home/claude/.e2e-fail.png", fullPage: true });
  console.log((await page.locator("body").innerText()).slice(0, 1500));
  throw e;
});
ok("bonus of Rs 10,000 recalculated: gross 1,10,000 less PF 3,000 and PT 200 = net 1,06,800");

await page.click('button:has-text("Submit for review")');
await page.waitForSelector('[aria-current="step"]:has-text("review")');
await must(
  await page.locator('button:has-text("Approve")').isDisabled(),
  "maker cannot approve their own run",
);
ok("submitted; the maker's Approve button is disabled");

// A second run for the same month is refused
await page.goto(`${BASE}/payroll`);
await page.click('button:has-text("Start payroll run")');
await page.waitForSelector("text=already exists");
ok("a second run for the same month is refused");

// Finance approves and processes
await fiona.goto(runUrl);
await fiona.click('button:has-text("Approve")');
await fiona.waitForSelector('[aria-current="step"]:has-text("approved")');
ok("finance approved (checker is different from maker)");

await fiona.click('button:has-text("Process payroll")');
await fiona.waitForSelector("text=Bank account or IFSC is missing");
await must(
  (await fiona.locator('[aria-current="step"]:has-text("processing")').count()) === 1,
  "run stays processing while a payment failed",
  fiona,
);
await must(
  (await fiona.locator('tr:has-text("Asha Tester") >> text=processed').count()) > 0,
  "Asha paid",
  fiona,
);
ok("processed: Asha paid, Ravi failed with a clear reason, run stays in processing");
await must(
  (await fiona.locator('button:has-text("Process payroll")').count()) === 0,
  "cannot process twice",
  fiona,
);
ok("Process button is gone: run cannot be processed again");

// Fix Ravi's bank details, retry
await page.goto(ravi + "/edit");
await page.fill("#bankAccount", "998877665544");
await page.fill("#bankIfsc", "ICIC0001234");
await page.click('button:has-text("Save changes")');
await page.waitForURL(ravi);
await fiona.reload();
await fiona.click('button:has-text("Retry 1 failed")');
await fiona.waitForSelector('[aria-current="step"]:has-text("paid")');
await fiona.reload();
await must(
  (await fiona.locator("td >> text=failed").count()) === 0,
  "no failed payments remain",
  fiona,
);
ok("retry after fixing bank details succeeded; run is paid");

// Bank file: finance yes, employee no
const csvStatus = await fiona.evaluate(async (id) => {
  const r = await fetch(`/api/payroll/${id}/bank-csv`);
  return { s: r.status, t: await r.text() };
}, runId);
await must(
  csvStatus.s === 200 && csvStatus.t.includes("123456789012") && csvStatus.t.includes("106800.00"),
  `bank csv (${csvStatus.s})`,
  fiona,
);
const csvEmp = await asha.evaluate(
  async (id) => (await fetch(`/api/payroll/${id}/bank-csv`)).status,
  runId,
);
await must(csvEmp === 403, `bank csv forbidden for employee (${csvEmp})`, asha);
ok("bank file export works for Finance and is 403 for employees");

// Payslips
await asha.goto(`${BASE}/payslips`);
await asha.waitForSelector("text=PS-");
const pdf = await asha.evaluate(async () => {
  const href = document.querySelector('a[href^="/api/payslips/"]').getAttribute("href");
  const r = await fetch(href);
  const b = new Uint8Array(await r.arrayBuffer());
  return {
    s: r.status,
    ct: r.headers.get("content-type"),
    magic: String.fromCharCode(...b.slice(0, 5)),
    size: b.length,
    href,
  };
});
await must(
  pdf.s === 200 && pdf.magic === "%PDF-" && pdf.size > 1500,
  `payslip pdf (${JSON.stringify(pdf)})`,
  asha,
);
ok("employee downloads own payslip as a real PDF");
// Another employee's payslip is forbidden for Asha
await page.goto(runUrl);
const links = await page.$$eval('a[href^="/api/payslips/"]', (a) =>
  a.map((x) => x.getAttribute("href")),
);
const other = links.find((l) => l !== pdf.href);
await must(Boolean(other), "found the other payslip link");
const forb = await asha.evaluate(async (h) => (await fetch(h)).status, other);
await must(forb === 403, `other's payslip forbidden (${forb})`, asha);
ok("employee cannot download someone else's payslip (403)");

// Webhook: bad signature, good signature, replay
const ref = (await page.locator("td.font-mono").allInnerTexts())
  .map((t) => t.match(/sim_\w+/)?.[0])
  .filter(Boolean)[1];
await must(Boolean(ref), "payment reference visible");
const evt = JSON.stringify({
  event: "payout.reversed",
  payload: { payout: { entity: { id: ref, failure_reason: "beneficiary bank rejected" } } },
});
const post = (sig, id) =>
  fetch(`${BASE}/api/webhooks/razorpay`, {
    method: "POST",
    body: evt,
    headers: {
      "x-razorpay-signature": sig,
      "x-razorpay-event-id": id,
      "content-type": "application/json",
    },
  });
const good = createHmac("sha256", SECRET).update(evt).digest("hex");
await must((await post("bad", "evt_a")).status === 401, "bad signature rejected");
const first = await (await post(good, `evt_${RUN}`)).json();
const replay = await (await post(good, `evt_${RUN}`)).json();
await must(
  first.ok === true && !first.duplicate && replay.duplicate === true,
  `webhook idempotent ${JSON.stringify([first, replay])}`,
);
await page.reload();
await must((await page.locator("text=reversed").count()) > 0, "reversal applied");
ok("webhook: bad signature 401, valid event applied once, replay ignored");

// Audit trail
await page.goto(`${BASE}/audit?action=payroll_run`);
await page.waitForSelector("text=Chain verified");
const a = await page.locator("body").innerText();
console.log(a.match(/payroll_run\.\w+/g));
await must(
  [
    "payroll_run.created",
    "payroll_run.submitted",
    "payroll_run.approved",
    "payroll_run.processed",
    "payroll_run.paid",
  ].every((x) => a.includes(x)),
  "audit has every lifecycle step",
);
const ex = await page.evaluate(async () => {
  const r = await fetch("/api/audit/export?action=payment");
  return { s: r.status, t: await r.text() };
});
await must(
  ex.s === 200 && ex.t.includes("payment.sent") && ex.t.split("\n")[0].startsWith("seq,"),
  "audit export",
);
await page.goto(`${BASE}/audit`);
await page.waitForSelector("text=Chain verified");
ok("audit log: lifecycle recorded, filter + CSV export work, chain still verifies");

await pool.end();
await must(errors.length === 0, `no uncaught browser errors: ${errors.join("|")}`);
ok("no uncaught browser errors");
console.log(`\n${steps.length} checks passed`);
await browser.close();
