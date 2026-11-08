// Phase 5: landing page, role dashboards, announcements + bell, product tour, accent, mobile nav.
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
const skipTour = (c) =>
  c.addInitScript(() => {
    try {
      localStorage.setItem("payflow:tour:v1", "done");
    } catch {}
  });
const newPage = async ({ tour = false, viewport } = {}) => {
  const c = await browser.newContext({ viewport });
  if (!tour) await skipTour(c);
  const p = await c.newPage();
  p.setDefaultTimeout(20000);
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return p;
};
async function must(cond, msg, p) {
  if (!cond) {
    await p?.screenshot({ path: "/home/claude/.e2e-fail.png", fullPage: true });
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

// ---- Landing page (signed out)
const land = await newPage();
const res = await land.goto(BASE);
await must(res.status() === 200, "landing should be 200", land);
await land.waitForSelector("h1");
await must(
  (await land.locator("h1").innerText()).toLowerCase().includes("payroll"),
  "hero headline",
  land,
);
for (const id of ["features", "preview", "pricing", "faq"])
  await must((await land.locator(`#${id}`).count()) === 1, `section #${id}`, land);
await must((await land.locator('a[href="/signup"]').count()) > 0, "signup CTA", land);
await land.locator("#faq details").first().locator("summary").click();
await must(
  await land
    .locator("#faq details")
    .first()
    .evaluate((d) => d.open),
  "FAQ item opens",
  land,
);
await land.click('[role="tab"]:has-text("Employee")');
await land.waitForSelector("text=Latest net pay");
ok("landing renders with all sections; FAQ and preview tabs work");
const wasDark = await land.evaluate(() => document.documentElement.classList.contains("dark"));
await land.click('button[aria-label^="Switch to"]');
await must(
  (await land.evaluate(() => document.documentElement.classList.contains("dark"))) !== wasDark,
  "theme toggle flips the class",
  land,
);
ok("theme toggle works on the landing page");
const lm = await newPage({ viewport: { width: 375, height: 800 } });
await lm.goto(BASE);
await lm.waitForSelector("h1");
await must(
  await lm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  "landing overflows horizontally at 375px",
  lm,
);
ok("landing has no horizontal scroll at phone width");

// ---- Owner, company, employee
const owner = await newPage();
await signup(owner, "Olivia Owner", OWNER);
await owner.fill("#name", "Acme Technologies Pvt Ltd");
await owner.fill("#state", "Karnataka");
await owner.click('button[type="submit"]');
await owner.waitForURL("**/setup");
const addEmp = async (code, first, email, join = "2026-01-01") => {
  await owner.goto(`${BASE}/employees/new`);
  await owner.fill("#employeeCode", code);
  await owner.fill("#firstName", first);
  await owner.fill("#lastName", "Tester");
  await owner.fill("#email", email);
  await owner.fill("#joinDate", join);
  await owner.selectOption("#workState", "Karnataka");
  await owner.fill("#pan", `ABCDE${1000 + Number(code.slice(1))}F`);
  await owner.click('button:has-text("Create employee")');
  await owner.waitForURL(/\/employees\/[0-9a-f-]{36}$/);
  const url = owner.url();
  await owner.fill("#ctc", "1200000");
  await owner.click('button:has-text("Save salary")');
  await owner.waitForSelector("text=Current");
  return url;
};
const ashaUrl = await addEmp("E101", "Asha", ASHA);
await addEmp("E102", "Ravi", `ravi${RUN}@example.com`);
await owner.click("text=Employees"); // no-op navigation sanity
await owner.goto(ashaUrl);
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
ok("company, two employees and an employee login created");

// ---- Admin dashboard
await owner.goto(`${BASE}/dashboard`);
await owner.waitForSelector("text=Active headcount");
await must(
  (await owner.locator("h1").innerText()).match(/Good (morning|afternoon|evening), Olivia/),
  "greeting",
  owner,
);
await owner.waitForSelector("text=Payroll countdown");
await owner.waitForSelector("text=Quick actions");
await owner
  .waitForFunction(
    () => /^2$/.test(document.querySelector('[aria-label="2"]')?.textContent ?? ""),
    null,
    { timeout: 8000 },
  )
  .catch(() => {});
await must(
  (await owner.locator('[aria-label="2"]').count()) > 0,
  "headcount KPI should count to 2",
  owner,
);
await must(
  (await owner.locator("text=without bank details").count()) > 0,
  "insight about missing bank details",
  owner,
);
await must(
  (await owner.locator('nav[aria-label="Dashboard view"]').count()) === 0,
  "owner without an employee record has a single view",
  owner,
);
ok("admin dashboard: KPIs, countdown, insights, quick actions");

// ---- Employee dashboard
await asha.goto(`${BASE}/dashboard`);
await asha.waitForSelector("text=Latest net pay");
await asha.waitForSelector("text=Leave balance");
await asha.waitForSelector("text=Casual");
await asha.waitForSelector("text=Tax summary");
await must(
  (await asha.locator("text=Active headcount").count()) === 0,
  "employee sees company KPIs",
  asha,
);
await must(
  (await asha.locator('button:has-text("New")').count()) === 0,
  "employee can post announcements",
  asha,
);
ok("employee dashboard shows only personal data, no admin controls");

// ---- Announcements + bell
await owner.click('button:has-text("New")');
await owner.fill("#an-title", "Diwali holiday");
await owner.fill("#an-body", "The office is closed on Friday.");
await owner.check('input[name="pinned"]');
await owner.check('input[name="notify"]');
await owner.click('button:has-text("Post")');
await owner.waitForSelector("text=Diwali holiday");
await asha.reload();
await asha.waitForSelector("text=Diwali holiday");
await must(
  (await asha.locator('button[aria-label^="Notifications, 1 unread"]').count()) === 1,
  "bell should show 1 unread",
  asha,
);
await asha.click('button[aria-label^="Notifications"]');
await asha.waitForSelector("text=Mark all read");
await asha.click("text=Mark all read");
await asha.waitForSelector('button[aria-label="Notifications"]');
ok("announcement posted, visible to employees, notification delivered and cleared");

// ---- Accent picker
await asha.keyboard.press("Escape");
await asha.click('button[aria-label="Account menu"]');
await asha.click('button[role="radio"][aria-label="Teal"]');
await must(
  (await asha.evaluate(() => document.documentElement.dataset.accent)) === "teal",
  "accent applied",
  asha,
);
await asha.reload();
await must(
  (await asha.evaluate(() => document.documentElement.dataset.accent)) === "teal",
  "accent persists after reload",
  asha,
);
ok("accent colour applies and persists");

// ---- Manager view (promote Asha, make her Ravi's manager)
const pool = new Pool({ host: "/tmp", port: 54329, user: "owner", database: "payflow_test" });
{
  const c = await pool.connect();
  try {
    await c.query("begin");
    const u = await c.query('select id from "user" where email = $1', [ASHA]);
    await c.query("select set_config('app.current_user', $1, true)", [u.rows[0].id]);
    await c.query("update memberships set role = 'manager' where user_id = $1", [u.rows[0].id]);
    const a = await c.query("select id from employees where email = $1", [ASHA]);
    const r = await c.query(
      "update employees set manager_id = $1 where employee_code = 'E102' and organization_id = (select organization_id from employees where id = $1)",
      [a.rows[0].id],
    );
    if (r.rowCount !== 1) throw new Error("could not set manager");
    await c.query("commit");
  } finally {
    c.release();
  }
}
await asha.goto(`${BASE}/dashboard`);
await asha.waitForSelector('nav[aria-label="Dashboard view"]');
await must(
  (await asha.locator('nav[aria-label="Dashboard view"] a').count()) === 2,
  "manager has Team and Me views",
  asha,
);
await asha.click('nav[aria-label="Dashboard view"] a:has-text("My team")');
await asha.waitForSelector("text=Team attendance today");
await asha.waitForSelector("text=Ravi Tester");
await asha.waitForSelector("text=Team cost / month");
await must(
  (await asha.locator("text=Attendance patterns to review").count()) === 1,
  "patterns card",
  asha,
);
ok("manager dashboard: team attendance, team cost, view switching");

// ---- Tour (fresh visitor) and palette action
const fresh = await newPage({ tour: true });
await fresh.goto(`${BASE}/login`);
await fresh.fill("#email", ASHA);
await fresh.fill("#password", PW);
await fresh.click('button[type="submit"]');
await fresh.waitForURL("**/dashboard");
await fresh.waitForSelector('[role="dialog"][aria-label^="Product tour"]', { timeout: 8000 });
await fresh.click('button:has-text("Next")');
await fresh.waitForSelector("text=2 of");
await fresh.keyboard.press("ArrowRight");
await fresh.keyboard.press("Escape");
await fresh.waitForSelector('[role="dialog"][aria-label^="Product tour"]', { state: "detached" });
await fresh.reload();
await fresh.waitForSelector("text=Team attendance today");
await fresh.waitForTimeout(1500);
await must(
  (await fresh.locator('[role="dialog"][aria-label^="Product tour"]').count()) === 0,
  "tour reappeared after being dismissed",
  fresh,
);
await fresh.keyboard.press("Control+k");
await fresh.fill('input[placeholder^="Type a page"]', "tour");
await fresh.keyboard.press("Enter");
await fresh.waitForSelector('[role="dialog"][aria-label^="Product tour"]');
ok("tour shows once, is keyboard-driven, and relaunches from the command palette");

// ---- Mobile navigation
const mob = await newPage({ viewport: { width: 390, height: 800 } });
await mob.goto(`${BASE}/login`);
await mob.fill("#email", ASHA);
await mob.fill("#password", PW);
await mob.click('button[type="submit"]');
await mob.waitForURL("**/dashboard");
await mob.click('button[aria-label="Open navigation"]');
await mob.click('nav[aria-label="Primary"] a:has-text("Leave")');
await mob.waitForURL("**/leave");
await must(
  await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  "app overflows horizontally at 390px",
  mob,
);
ok("mobile navigation drawer works and the app fits a phone screen");

await must(errors.length === 0, `browser errors: ${errors.join(" | ")}`, owner);
await pool.end();
await browser.close();
console.log("ALL PHASE 5 CHECKS PASSED");
