// Phase 8: visual builder, automations (events, tasks, approvals), public API keys/scopes/rate limits,
// signed webhooks, live notifications (SSE), automatic payroll page, cron endpoint, RBAC.
// Needs the app on E2E_BASE started with ALLOW_PRIVATE_WEBHOOKS=1 and CRON_SECRET=cron_test_secret_123,
// plus the throwaway Postgres on :54329.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
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
const pool = new Pool({ connectionString: "postgres://owner@localhost:54329/payflow_test" });
const errors = [];
const newPage = async () => {
  const c = await browser.newContext();
  await c.addInitScript(() => {
    try {
      localStorage.setItem("payflow:tour:v1", "done");
    } catch {}
  });
  const p = await c.newPage();
  p.setDefaultTimeout(Number(process.env.E2E_TIMEOUT ?? 20000));
  p.on("pageerror", (e) => errors.push(String(e) + " " + (e.stack ?? "").slice(0, 400)));
  return p;
};
async function must(cond, msg, p) {
  if (!cond) {
    await p?.screenshot({ path: "/home/claude/.e2e-fail.png", fullPage: true });
    console.log("page errors:", errors.slice(-3));
    throw new Error(`FAIL: ${msg} @ ${p?.url()}`);
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

// A receiver that records what PayFlow posts.
const hits = [];
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    hits.push({ body, headers: req.headers });
    res.end("ok");
  });
});
await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
const RPORT = receiver.address().port;

try {
  const owner = await newPage();
  await signup(owner, "Olivia Owner", OWNER);
  await owner.fill("#name", "Acme Technologies Pvt Ltd");
  await owner.fill("#state", "Karnataka");
  await owner.click('button[type="submit"]');
  await owner.waitForURL("**/setup");
  const org = (await q("select id from organizations order by created_at desc limit 1"))[0].id;
  const ownerId = (await q('select id from "user" where email=$1', [OWNER]))[0].id;

  // ---- Builder: template -> canvas -> edit -> validation -> save -> enable
  await owner.goto(`${BASE}/workflows`);
  await owner.getByRole("heading", { name: "Automations", exact: true }).waitFor();
  await owner
    .locator("div.flex-col.justify-between.rounded-xl", { hasText: "New joiner welcome" })
    .getByRole("button", { name: /Use template/ })
    .first()
    .click();
  await owner.waitForURL(/\/workflows\/[0-9a-f-]{36}$/);
  await owner.waitForSelector(".react-flow__node");
  await must(
    (await owner.locator(".react-flow__node").count()) === 4,
    "template draws 4 steps",
    owner,
  );
  await must(
    (await owner.locator(".react-flow__edge").count()) === 3,
    "template draws 3 connections",
    owner,
  );
  await owner.locator(".react-flow__node", { hasText: "Welcome to the team" }).click();
  await owner.fill('input[aria-label="Subject"]', "Hello {{employee.name}}, welcome aboard");
  await owner.getByRole("button", { name: "Condition" }).click();
  await owner.waitForSelector("text=This step is not connected to the trigger.");
  await must(
    (await owner.getByRole("button", { name: "Save changes" }).count()) === 1,
    "unsaved state shown",
    owner,
  );
  await owner.getByRole("button", { name: "Remove step" }).click();
  await owner.waitForSelector("text=Ready to turn on.");
  await owner.getByRole("button", { name: "Save changes" }).click();
  await owner.waitForSelector("text=Saved.");
  const def = (await q("select definition from workflows where organization_id=$1", [org]))[0]
    .definition;
  await must(def.nodes.length === 4, "removed step is gone from the saved definition", owner);
  await must(
    def.nodes.find((n) => n.id === "e").data.config.subject.startsWith("Hello"),
    "edit saved",
    owner,
  );
  await owner.getByRole("switch", { name: /Turn on/ }).click();
  await owner.waitForSelector('button[role=switch][aria-checked="true"]');
  ok("builder: template, edit, live validation, save, enable");

  // ---- An invalid automation cannot be turned on
  await owner.goto(`${BASE}/workflows`);
  await owner.getByRole("button", { name: "New automation" }).first().click();
  await owner.waitForURL(/\/workflows\/[0-9a-f-]{36}$/);
  await owner.goto(`${BASE}/workflows`);
  const blank = await q(
    "select id from workflows where organization_id=$1 and template_key is null",
    [org],
  );
  await owner.getByRole("switch", { name: /Turn on Untitled automation/ }).click();
  await owner
    .waitForSelector("text=Add at least one step after the trigger.", { timeout: 8000 })
    .catch(() => {});
  await must(
    (await q("select enabled from workflows where id=$1", [blank[0].id]))[0].enabled === false,
    "empty automation cannot be enabled",
    owner,
  );
  ok("validation blocks enabling an incomplete automation");

  // ---- Real event: creating an employee runs the welcome automation
  await owner.goto(`${BASE}/employees/new`);
  await owner.fill("#employeeCode", "E101");
  await owner.fill("#firstName", "Asha");
  await owner.fill("#lastName", "Tester");
  await owner.fill("#email", ASHA);
  await owner.fill("#joinDate", "2026-01-01");
  await owner.selectOption("#workState", "Karnataka");
  await owner.fill("#pan", "ABCDE1101F");
  await owner.click('button:has-text("Create employee")');
  await owner.waitForURL(/\/employees\/[0-9a-f-]{36}$/);
  const run = await until(
    async () =>
      (
        await q(
          "select * from workflow_runs where organization_id=$1 and status='succeeded' and trigger_kind='employee.joined'",
          [org],
        )
      )[0],
  );
  await must(!!run, "welcome automation ran after the employee was created", owner);
  const email = run.steps.find((s) => s.label === "Send email");
  await must(
    email.status === "skipped" && /not configured/.test(email.note),
    "email says it was skipped, not sent",
    owner,
  );
  const tasks = await q(
    "select title from workflow_tasks where organization_id=$1 and status='open' order by title",
    [org],
  );
  await must(
    tasks.length === 2 && tasks[0].title === "Collect documents from Asha Tester",
    "two tasks created",
    owner,
  );
  await owner.goto(`${BASE}/workflows`);
  await owner.getByText("Collect documents from Asha Tester").waitFor();
  await owner
    .getByRole("button", { name: "Mark done: Collect documents from Asha Tester" })
    .click();
  await until(
    async () =>
      (
        await q(
          "select 1 from workflow_tasks where title like 'Collect documents%' and status='done'",
        )
      )[0],
  );
  ok("event triggers run, tasks appear in the inbox and can be completed");

  // ---- Approval: test run pauses, approve resumes the branch
  await owner.getByRole("button", { name: "New automation" }).first().waitFor();
  await owner
    .locator("div.flex-col.justify-between.rounded-xl", { hasText: "Long leave needs HR sign-off" })
    .getByRole("button", { name: /Use template/ })
    .first()
    .click();
  await owner.waitForURL(/\/workflows\/[0-9a-f-]{36}$/);
  await owner.getByRole("button", { name: "Test run" }).click();
  await owner.waitForSelector("text=Test run started");
  const waiting = await until(
    async () =>
      (
        await q("select * from workflow_runs where organization_id=$1 and status='waiting'", [org])
      )[0],
  );
  await must(!!waiting, "test run pauses on the approval step", owner);
  await owner.goto(`${BASE}/workflows`);
  await owner.getByRole("button", { name: /^Approve: Review Test Employee/ }).click();
  const done = await until(
    async () =>
      (
        await q("select status, steps from workflow_runs where id=$1 and status='succeeded'", [
          waiting.id,
        ])
      )[0],
  );
  await must(
    !!done && done.steps.some((s) => s.label.includes("Send email")),
    "approval resumed and the next step ran",
    owner,
  );
  ok("approval pauses a run and resumes it when decided");

  // ---- Developers: API keys
  await owner.goto(`${BASE}/developers`);
  await owner.getByRole("heading", { name: "Developers", exact: true }).waitFor();
  const mkKey = async (name, scope, limit) => {
    await owner.fill("#k-name", name);
    await owner.fill("#k-limit", String(limit));
    for (const l of await owner
      .locator("fieldset >> nth=0")
      .locator('input[type="checkbox"]')
      .all())
      await l.uncheck();
    await owner.locator("label", { hasText: scope }).locator("input").check();
    const prev = await owner
      .getByTestId("secret")
      .first()
      .innerText()
      .catch(() => "");
    await owner.getByRole("button", { name: "Create key" }).click();
    const el = owner.getByTestId("secret").first();
    await until(async () => {
      const t = (await el.innerText().catch(() => "")).trim();
      return t && t !== prev.trim();
    });
    return (await el.innerText()).trim();
  };
  const key = await mkKey("Reader", "employees:read", 60);
  await must(/^pf_live_[0-9a-f]{48}$/.test(key), "key has the expected shape", owner);
  const stored = await q("select key_hash, prefix from api_keys where organization_id=$1", [org]);
  await must(
    !stored.some((r) => r.key_hash === key) && stored[0].key_hash.length === 64,
    "only a hash is stored",
    owner,
  );
  const api = (path, k = key) =>
    fetch(`${BASE}/api/v1${path}`, { headers: k ? { authorization: `Bearer ${k}` } : {} });
  let r = await api("/employees");
  const body = await r.json();
  await must(
    r.status === 200 && body.data.length === 1 && body.meta.total === 1,
    "key lists employees",
    owner,
  );
  const flat = JSON.stringify(body);
  await must(
    !/pan|aadhaar|bank|ABCDE/i.test(flat.replace(/panIndex/g, "")),
    "no PAN/bank/Aadhaar fields leak",
    owner,
  );
  await must(r.headers.get("x-ratelimit-limit") === "60", "rate limit headers present", owner);
  await must((await api("/employees/" + body.data[0].id)).status === 200, "single employee", owner);
  await must((await api("/employees/not-a-uuid")).status === 404, "bad id is a clean 404", owner);
  await must((await api("/payroll-runs")).status === 403, "missing scope is 403", owner);
  await must((await api("/employees", null)).status === 401, "no key is 401", owner);
  await must(
    (await api("/employees", "pf_live_" + "0".repeat(48))).status === 401,
    "unknown key is 401",
    owner,
  );
  await must(
    (await fetch(`${BASE}/api/v1/openapi.json`)).status === 200,
    "openapi spec is served",
    owner,
  );
  ok("public API: auth, scopes, field allow-list, spec");

  const limited = await mkKey("Limited", "employees:read", 2);
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await api("/employees", limited)).status);
  await must(codes.join() === "200,200,429,429", `rate limit enforced (${codes})`, owner);
  const rl = await api("/employees", limited);
  await must(Number(rl.headers.get("retry-after")) >= 1, "429 has retry-after", owner);
  owner.once("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: "Revoke Reader" }).click();
  await until(
    async () =>
      (
        await q(
          "select 1 from api_keys where organization_id=$1 and name='Reader' and revoked_at is not null",
          [org],
        )
      )[0],
  );
  await must((await api("/employees")).status === 401, "revoked key stops working at once", owner);
  ok("rate limits and revocation");

  // ---- Webhooks: signed delivery
  await owner.reload();
  await owner.fill("#w-url", `http://127.0.0.1:${RPORT}/hook`);
  await owner.getByRole("button", { name: "Add endpoint" }).click();
  const secret = (await owner.getByTestId("secret").last().innerText()).trim();
  await must(secret.startsWith("whsec_"), "signing secret shown once", owner);
  const enc = (
    await q("select secret_enc from webhook_endpoints where organization_id=$1", [org])
  )[0].secret_enc;
  await must(!enc.includes(secret), "secret is encrypted at rest", owner);
  await owner.reload();
  await owner.getByRole("button", { name: "Send test" }).click();
  const hit = await until(() => hits.find((h) => JSON.parse(h.body).event === "ping"));
  await must(!!hit, "receiver got the test event", owner);
  const ts = hit.headers["x-payflow-timestamp"];
  const want = "v1=" + createHmac("sha256", secret).update(`${ts}.${hit.body}`).digest("hex");
  await must(
    hit.headers["x-payflow-signature"] === want,
    "signature verifies with the shown secret",
    owner,
  );
  await until(
    async () => (await q("select 1 from webhook_deliveries where status='delivered'"))[0],
  );
  ok("webhooks: signed, secret encrypted, delivered");

  // ---- Real event reaches the webhook too (payroll.approved subscribers are separate; use employee-less check on tick)
  await q(
    "update webhook_endpoints set events = array['ping','employee.joined'] where organization_id=$1",
    [org],
  );

  // ---- SSE: a notification appears in the bell without a reload
  await owner.goto(`${BASE}/dashboard`);
  await owner.waitForSelector('button[aria-label^="Notifications"]');
  const before = await owner
    .locator('button[aria-label^="Notifications"]')
    .getAttribute("aria-label");
  await q(
    "insert into notifications (organization_id,user_id,type,title) values ($1,$2,'test','Live update ' || $3)",
    [org, ownerId, String(RUN)],
  );
  const live = await until(
    async () =>
      (await owner.locator('button[aria-label^="Notifications"]').getAttribute("aria-label")) !==
      before,
    15000,
  );
  await must(!!live, "bell updates live over SSE", owner);
  await owner.locator('button[aria-label^="Notifications"]').click();
  await owner.getByText(`Live update ${RUN}`).waitFor();
  ok("live notifications over server-sent events");

  // ---- Automatic payroll page
  await owner.goto(`${BASE}/workflows/pipeline`);
  await owner.getByLabel("Prepare payroll automatically every month").check();
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await owner.waitForSelector("text=Saved.");
  await owner.getByRole("button", { name: "Run now for last month" }).click();
  await owner.waitForSelector("text=Stopped at: Create draft payroll");
  await owner.waitForSelector("text=Not started");
  const blocked = (
    await q("select status, detail from pipeline_steps where organization_id=$1 and step='draft'", [
      org,
    ])
  )[0];
  await must(
    blocked?.status === "blocked" && /salar/i.test(blocked.detail),
    "pipeline holds with a clear reason",
    owner,
  );
  ok("automatic payroll holds and explains why");

  // ---- Cron endpoint
  await must(
    (await fetch(`${BASE}/api/cron/tick`)).status === 401,
    "cron without secret is 401",
    owner,
  );
  await must(
    (await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: "Bearer wrong" } }))
      .status === 401,
    "cron wrong secret is 401",
    owner,
  );
  const tick = await fetch(`${BASE}/api/cron/tick`, {
    headers: { authorization: "Bearer cron_test_secret_123" },
  });
  await must(
    tick.status === 200 && (await tick.json()).ok === true,
    "cron tick runs with the secret",
    owner,
  );
  ok("cron tick endpoint is authenticated");

  // ---- RBAC: an employee cannot reach automations or developer pages
  await owner.goto(`${BASE}/employees`);
  const empUrl = (await q("select id from employees where organization_id=$1", [org]))[0].id;
  await owner.goto(`${BASE}/employees/${empUrl}`);
  await owner.click('button:has-text("Invite to PayFlow")');
  await owner.click('button:has-text("Create invite link")');
  const link = (await owner.inputValue('input[aria-label="Invite link"]')).replace(
    /^https?:\/\/[^/]+/,
    BASE,
  );
  const asha = await newPage();
  await signup(asha, "Asha Tester", ASHA);
  await asha.goto(link);
  await asha.click('button:has-text("Accept invitation")');
  await asha.waitForURL("**/dashboard");
  for (const path of ["/workflows", "/workflows/pipeline", "/developers"]) {
    await asha.goto(`${BASE}${path}`);
    await asha.waitForURL("**/dashboard**").catch(() => {});
    await must(asha.url().includes("/dashboard"), `employee is redirected away from ${path}`, asha);
  }
  await must(
    (await asha.getByRole("link", { name: "Automations" }).count()) === 0,
    "nav hides Automations from employees",
    asha,
  );
  ok("RBAC: employees cannot open automation or developer pages");

  const bad = errors.filter((e) => !/ResizeObserver/.test(e));
  await must(bad.length === 0, `no page errors: ${bad.slice(0, 2)}`, owner);
  console.log("PHASE 8 SMOKE: ALL PASSED");
} finally {
  receiver.close();
  await browser.close();
  await pool.end();
}
