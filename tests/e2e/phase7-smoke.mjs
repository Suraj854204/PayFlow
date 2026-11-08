// Phase 7: agentic confirm flow, RBAC on actions, policy RAG, Document AI verification, generators, voice toggles.
// Needs the app on E2E_BASE (no GEMINI_API_KEY) and the throwaway Postgres on :54329.
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
const ask = async (p, text, expect) => {
  await p.waitForSelector('button[aria-label="Send"], button[aria-label="Stop"]');
  await p.waitForSelector('button[aria-label="Stop"]', { state: "detached" });
  await p.fill("#paybot-input", text);
  await p.keyboard.press("Enter");
  try {
    await p.waitForSelector(`[role=dialog] >> text=${expect}`, { timeout: 15000 });
  } catch (e) {
    console.log("DIALOG TEXT:", (await p.locator("[role=dialog]").innerText()).slice(-600));
    throw e;
  }
};
const openBot = async (p) => {
  if ((await p.locator('[role=dialog][aria-label="PayBot assistant"]').count()) === 0)
    await p.click('button[aria-label="Open PayBot"]');
  await p.waitForSelector("#paybot-input");
};
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;

try {
  const owner = await newPage();
  await signup(owner, "Olivia Owner", OWNER);
  await owner.fill("#name", "Acme Technologies Pvt Ltd");
  await owner.fill("#state", "Karnataka");
  await owner.click('button[type="submit"]');
  await owner.waitForURL("**/setup");
  const addEmp = async (code, first, email) => {
    await owner.goto(`${BASE}/employees/new`);
    await owner.fill("#employeeCode", code);
    await owner.fill("#firstName", first);
    await owner.fill("#lastName", "Tester");
    await owner.fill("#email", email);
    await owner.fill("#joinDate", "2026-01-01");
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
  ok("company, employees and an employee login created");

  const org = (await q("select id from organizations order by created_at desc limit 1"))[0].id;
  await q("insert into departments (organization_id, name) values ($1,'Engineering')", [org]).catch(
    async () => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.current_org',$1,true)", [org]);
        await c.query("insert into departments (organization_id, name) values ($1,'Engineering')", [
          org,
        ]);
        await c.query("commit");
      } finally {
        c.release();
      }
    },
  );
  await q(
    "update employees set department_id=(select id from departments where name='Engineering' and organization_id=$1) where organization_id=$1",
    [org],
  );

  // ---- Employee applies for leave
  const d = new Date(Date.now() + 21 * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const day = d.toISOString().slice(0, 10);
  await asha.goto(`${BASE}/leave`);
  await asha.fill("#lv-from", day);
  await asha.fill("#lv-to", day);
  await asha.click('button:has-text("Request")');
  await asha.waitForSelector("text=Pending");
  ok("employee leave request created");

  // ---- Employee cannot get an action card
  await openBot(asha);
  await ask(asha, "Approve Asha's leave", "do not have access");
  await must(
    (await asha.locator("[role=dialog] [aria-label^='Confirm:']").count()) === 0,
    "employee must not get a confirm card",
    asha,
  );
  await asha.keyboard.press("Escape");
  ok("employee cannot propose or confirm actions (RBAC)");

  // ---- Owner: approve leave through PayBot with a confirm card
  await owner.goto(`${BASE}/dashboard`);
  await openBot(owner);
  await ask(owner, "Approve Asha's leave", "Nothing has changed yet");
  const card = owner.locator("[role=dialog] [aria-label^='Confirm:']");
  await card.waitFor();
  await must(
    (await card.innerText()).includes("Pending") && (await card.innerText()).includes("Approved"),
    "card shows before/after",
    owner,
  );
  await must(
    (await q("select status from leave_requests order by created_at desc limit 1"))[0].status ===
      "pending",
    "nothing changed before confirmation",
    owner,
  );
  await card.locator('button:has-text("Confirm")').click();
  await owner.locator("[role=dialog]").getByText("Done", { exact: true }).waitFor();
  await must(
    (await q("select status from leave_requests order by created_at desc limit 1"))[0].status ===
      "approved",
    "leave approved after confirm",
    owner,
  );
  const audit = await q(
    "select action from audit_logs where organization_id=$1 and action like 'ai.action.%' order by seq",
    [org],
  );
  await must(
    audit.some((a) => a.action === "ai.action.executed"),
    "audit entry for the AI action",
    owner,
  );
  await must(
    (
      await q(
        "select count(*)::int n from audit_logs where organization_id=$1 and action='leave.approved'",
        [org],
      )
    )[0].n === 1,
    "domain audit entry too",
    owner,
  );
  ok("approve-leave: confirm card, nothing changed until confirmed, executed + audited");

  // ---- Cancel a proposal leaves it unexecuted
  await owner.goto(`${BASE}/dashboard`);
  await openBot(owner);
  await ask(owner, "create payroll draft for this month", "Nothing has changed yet");
  const c2 = owner.locator("[role=dialog] [aria-label^='Confirm:']").last();
  await c2.locator('button:has-text("Cancel")').click();
  await c2.locator("text=Cancelled").waitFor();
  await must(
    (await q("select count(*)::int n from payroll_runs where organization_id=$1", [org]))[0].n ===
      0,
    "no run after cancel",
    owner,
  );
  ok("cancelling a proposal changes nothing");

  // ---- Create the draft for real
  await ask(owner, "create payroll draft for this month", "Nothing has changed yet");
  const c3 = owner.locator("[role=dialog] [aria-label^='Confirm:']").last();
  await c3.locator('button:has-text("Confirm")').click();
  await c3.getByText("Done", { exact: true }).waitFor();
  await must(
    (await q("select status from payroll_runs where organization_id=$1", [org]))[0].status ===
      "draft",
    "draft created",
    owner,
  );
  ok("payroll draft created through the confirm flow");

  // ---- Destructive: extra confirmation
  await ask(owner, "cancel the payroll run for this month", "Nothing has changed yet");
  const c4 = owner.locator("[role=dialog] [aria-label^='Confirm:']").last();
  await must(
    await c4.locator('button:has-text("Confirm")').isDisabled(),
    "destructive Confirm disabled until CONFIRM typed",
    owner,
  );
  await c4.locator("input").fill("confirm please");
  await must(
    await c4.locator('button:has-text("Confirm")').isDisabled(),
    "wrong word keeps it disabled",
    owner,
  );
  await c4.locator("input").fill("CONFIRM");
  await c4.locator('button:has-text("Confirm")').click();
  await c4.getByText("Done", { exact: true }).waitFor();
  await must(
    (await q("select status from payroll_runs where organization_id=$1", [org]))[0].status ===
      "cancelled",
    "run cancelled",
    owner,
  );
  ok("destructive action needs the typed CONFIRM, then cancels the run");

  // ---- Department raise: bulk, destructive, atomic
  await ask(owner, "raise engineering salary by 5%", "Nothing has changed yet");
  // The assistant's sentence can arrive before its confirmation card, so wait for the right card.
  const c5 = owner
    .locator("[role=dialog] [aria-label^='Confirm:']", { hasText: "Total annual CTC" })
    .last();
  await c5.waitFor();
  const txt = await c5.innerText();
  await must(
    txt.includes("₹12,60,000") && txt.includes("Total annual CTC"),
    "raise card lists exact new CTC",
    owner,
  );
  await must(
    (await q("select count(*)::int n from employee_salaries where organization_id=$1", [org]))[0]
      .n === 2,
    "no salary change before confirm",
    owner,
  );
  await c5.locator("input").fill("CONFIRM");
  await c5.locator('button:has-text("Confirm")').click();
  await c5.getByText("Done", { exact: true }).waitFor();
  const sal = await q(
    "select ctc_annual::bigint c from employee_salaries where organization_id=$1 order by created_at",
    [org],
  );
  await must(
    sal.length === 4 && sal.filter((s) => Number(s.c) === 126000000).length === 2,
    "two revisions at +5%",
    owner,
  );
  ok("department raise: exact preview, applied atomically as append-only revisions");

  // ---- History reload keeps the card and its final state
  await owner.click('button[aria-label="Chat history"]');
  await owner.click("text=Approve Asha's leave");
  await owner
    .locator("[role=dialog] [aria-label^='Confirm:']")
    .getByText("Done", { exact: true })
    .waitFor();
  ok("action card reloads from history with its final state");
  await owner.keyboard.press("Escape");

  // ---- Policy RAG: PDF + text upload, employee asks
  await owner.goto(`${BASE}/policies`);
  const pdfPage = await owner.context().newPage();
  await pdfPage.setContent(
    "<h1>Leave and Notice Policy</h1><p>The notice period for all confirmed employees is sixty days. Employees must serve the full notice period unless HR approves a waiver.</p><p>Casual leave is limited to twelve days per financial year.</p>",
  );
  const pdf = await pdfPage.pdf();
  await pdfPage.close();
  await owner.setInputFiles('input[name="file"]', {
    name: "leave-policy.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await owner.fill('input[name="title"]', "Leave and Notice Policy");
  await owner.click('button:has-text("Upload")');
  await owner.waitForSelector("text=Leave and Notice Policy");
  await owner.waitForSelector("text=Keyword search");
  ok("policy PDF uploaded, text extracted and indexed");
  await owner.setInputFiles('input[name="file"]', {
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf at all, just some words that are long enough to pass"),
  });
  await owner.click('button:has-text("Upload")');
  await owner.waitForSelector("text=valid PDF");
  ok("fake PDF is rejected");

  await asha.goto(`${BASE}/policies`);
  await must(
    (await asha.locator('input[name="file"]').count()) === 0,
    "employee must not see upload",
    asha,
  );
  await asha.goto(`${BASE}/dashboard`);
  await openBot(asha);
  await ask(asha, "What is the notice period policy?", "sixty days");
  await asha.waitForSelector(
    '[role=dialog] [aria-label="Sources"] >> text=Leave and Notice Policy',
  );
  await asha.waitForSelector("[role=dialog] >> text=Page 1");
  ok("PayBot answers a policy question with the passage and a page citation");
  await ask(asha, "What is the policy on cryptocurrency staking?", "could not find");
  ok("no invented policy when nothing matches");

  // ---- Document AI
  await owner.goto(`${BASE}/documents`);
  const shot = await owner.context().newPage();
  await shot.setContent(
    "<div style='font:20px sans-serif;padding:20px'>INCOME TAX DEPARTMENT<br>Permanent Account Number<br>QWERT1234Y</div>",
  );
  const png = await shot.screenshot();
  await shot.close();
  await owner.selectOption('select[name="employeeId"]', { label: "Asha Tester" });
  await owner.selectOption('select[name="kind"]', "pan");
  await owner.setInputFiles('input[name="file"]', {
    name: "pan.png",
    mimeType: "image/png",
    buffer: png,
  });
  await owner.click('button:has-text("Read document")');
  await owner.waitForSelector("text=Needs verification");
  const verify = owner.locator('button:has-text("Verify and save")');
  await must(await verify.isDisabled(), "verify disabled while fields are empty/invalid", owner);
  await owner.fill('section:has-text("Needs verification") input >> nth=0', "bad");
  await owner.waitForSelector("text=PAN looks like");
  await must(await verify.isDisabled(), "verify disabled for a bad PAN", owner);
  await owner.fill('section:has-text("Needs verification") input >> nth=0', "qwert1234y");
  await verify.click();
  await owner.waitForSelector("text=verified");
  const emp = (await q("select pan_enc from employees where email=$1", [ASHA]))[0];
  await must(emp.pan_enc && !emp.pan_enc.includes("QWERT"), "PAN saved encrypted", owner);
  await must(
    (await q("select fields_enc from document_extractions order by created_at desc limit 1"))[0]
      .fields_enc.length > 0,
    "row kept",
    owner,
  );
  ok(
    "document upload -> human verification -> saved to the employee (encrypted), AI engine honest in manual mode",
  );
  await owner.setInputFiles('input[name="file"]', {
    name: "x.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image, just text that is long enough"),
  });
  await owner.click('button:has-text("Read document")');
  await owner.waitForSelector("text=Upload a JPG");
  ok("non-image upload rejected by content, not by name");

  // ---- Generators
  await owner.goto(`${BASE}/generators`);
  await owner.click('[role=tab]:has-text("Offer letter")');
  await owner.fill('input[name="candidateName"]', "Meera Nair");
  await owner.fill('input[name="role"]', "Backend Engineer");
  await owner.fill('input[name="department"]', "Engineering");
  await owner.fill('input[name="location"]', "Bengaluru");
  await owner.fill('input[name="annualCtcRupees"]', "1500000");
  await owner.fill('input[name="joiningDate"]', "2026-12-01");
  await owner.click('button:has-text("Generate draft")');
  await owner.waitForSelector('section[aria-label="Generated draft"]');
  const body = await owner.inputValue('section[aria-label="Generated draft"] textarea');
  await must(
    body.includes("Meera Nair") && body.includes("₹15,00,000") && body.includes("1 December 2026"),
    "offer letter has the facts",
    owner,
  );
  await owner.click('[role=tab]:has-text("Announcement email")');
  ok("offer letter generated with the exact facts (template mode)");

  // ---- Voice controls (the mic itself needs a real microphone)
  await openBot(asha);
  await asha.click('button[aria-label^="Voice language"]');
  await asha.waitForSelector('button[aria-label^="Voice language: Hindi"]');
  await asha.click('button[aria-label="Read answers aloud"]');
  await asha.waitForSelector('button[aria-label="Read answers aloud"][aria-pressed="true"]');
  ok("voice language and read-aloud toggles work");

  const act = await q(
    "select kind, status from ai_actions where organization_id=$1 order by created_at",
    [org],
  );
  console.log("ai_actions", JSON.stringify(act));
  if (errors.length) throw new Error("page errors: " + errors.slice(0, 3).join(" | "));
  console.log("ALL PHASE 7 CHECKS PASSED");
} finally {
  await browser.close();
  await pool.end();
}
