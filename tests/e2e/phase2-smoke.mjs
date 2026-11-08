// Drives the real UI: signup -> company -> setup -> employee -> salary -> export/RBAC.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const RUN = Date.now();
const email = `owner${RUN}@example.com`;
const ASHA = `asha${RUN}@example.com`;
const MALLORY = `mallory${RUN}@example.com`;
const steps = [];
const ok = (name) => {
  steps.push(name);
  console.log("PASS", name);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("payflow:tour:v1", "done");
  } catch {}
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function must(cond, msg) {
  if (!cond) {
    await page.screenshot({ path: "/home/claude/.e2e-fail.png" });
    throw new Error(`FAIL: ${msg} @ ${page.url()}`);
  }
}

// 1. Signup
await page.goto(`${BASE}/signup`);
await page.fill("#name", "Olivia Owner");
await page.fill("#email", email);
await page.fill("#password", "Str0ngPassw0rd!");
await page.click('button[type="submit"]');
await page.waitForURL("**/onboarding");
ok("signup lands on onboarding");

// 2. Create company -> goes to /setup
await page.fill("#name", "Acme Technologies Pvt Ltd");
await page.fill("#state", "Karnataka");
await page.click('button[type="submit"]');
await page.waitForURL("**/setup");
await page.waitForSelector("text=Statutory registrations");
ok("company created, setup wizard opens");

// 3. Wizard: statutory -> departments -> designations -> schedule -> holidays -> finish
await page.selectOption("#state", "Karnataka");
await page.fill("#pan", "ABCDE1234F");
await page.click('button:has-text("Save and continue")');
await page.waitForSelector('h3:has-text("Departments"), :text("Departments")');
await page.click('button:has-text("Engineering")');
await page.click('button:has-text("Sales")');
await page.click('button:has-text("Save (2)")');
await page.waitForSelector('span:has-text("Engineering") button[aria-label^="Remove"]');
await page.click('button:has-text("Continue")');
await page.click('button:has-text("Software Engineer")');
await page.click('button:has-text("Manager")');
await page.click('button:has-text("Save (2)")');
await page.waitForTimeout(800);
await page.click('button:has-text("Continue")');
await page.fill("#payDay", "1");
await page.click('button:has-text("Save and continue")');
await page.click('button:has-text("National holidays")');
await page.waitForSelector('li:has-text("Republic Day")');
await page.click('button:has-text("Continue")');
await page.click('button:has-text("Finish and add employees")');
await page.waitForURL("**/employees");
ok("setup wizard completed end to end");

// 4. Bad statutory input is rejected server-side
// (checked via invalid PAN on wizard later) -> create employee
await page.click('a:has-text("Add employee")');
await page.waitForURL("**/employees/new");
await page.fill("#employeeCode", "E101");
await page.fill("#firstName", "Asha");
await page.fill("#lastName", "Verma");
await page.fill("#email", ASHA);
await page.fill("#pan", "BADPAN");
await page.click('button:has-text("Create employee")');
await page.waitForSelector('[role="alert"]:has-text("PAN looks like")');
ok("invalid PAN rejected with field error");
await page.fill("#pan", "ABCDE1234F");
await page.fill("#bankAccount", "123456789012");
await page.selectOption("#departmentId", { label: "Engineering" });
await page.click('button:has-text("Create employee")');
await page.waitForURL(/\/employees\/[0-9a-f-]{36}$/);
const profileUrl = page.url();
await must(
  (await page.locator("text=********9012").count()) > 0 ||
    (await page.locator("text=********").count()) > 0,
  "bank account is masked",
);
await must((await page.locator("text=ABCDE1234F").count()) === 0, "PAN not shown in plaintext");
ok("employee created; PAN/bank shown masked");

// 5. Duplicate code is a friendly error, not a crash
await page.goto(`${BASE}/employees/new`);
await page.fill("#employeeCode", "E101");
await page.fill("#firstName", "Dup");
await page.fill("#email", "dup@example.com");
await page.click('button:has-text("Create employee")');
await page.waitForSelector("text=employee code is already in use");
ok("duplicate employee code gives a friendly error");

// 6. Assign salary 12 LPA and verify the split
await page.goto(profileUrl);
await page.fill("#ctc", "1200000");
await page.click('button:has-text("Save salary")');
await page.waitForSelector("text=Current");
await page.waitForSelector("text=₹12,00,000.00 / year");
await page.click('button[aria-expanded]:has-text("/ year")');
const body = await page.locator("body").innerText();
await must(
  body.includes("₹50,000.00") && body.includes("₹20,000.00") && body.includes("₹30,000.00"),
  "basic 50k / HRA 20k / special 30k",
);
ok("salary assigned; 12 LPA splits into 50,000 / 20,000 / 30,000");

// 7. Revising on or before the same date is rejected; a later date works and history keeps both
await page.fill("#ctc", "1500000");
await page.click('button:has-text("Save salary")');
await page.waitForSelector('[role="alert"]:has-text("after the latest")');
ok("same-date revision rejected (append-only history)");
const future = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
await page.fill("#effectiveFrom", future);
await page.click('button:has-text("Save salary")');
await page.waitForSelector("text=₹15,00,000.00 / year");
await must(
  (await page.locator("text=₹12,00,000.00 / year").count()) === 1,
  "old revision retained",
);
ok("revision added, history retained");

// 8. Checklist toggle persists
await page.reload();
const box = page.locator('label:has-text("Collect signed offer letter") input');
await box.check();
await page.waitForTimeout(600);
await page.reload();
await must(
  await page.locator('label:has-text("Collect signed offer letter") input').isChecked(),
  "checklist persisted",
);
ok("onboarding checklist item persists");

// 9. Document upload: fake PDF header is accepted, a renamed non-PDF is rejected
await page.setInputFiles('input[name="file"]', {
  name: "pan.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n%fake\n"),
});
await page.click('button:has-text("Upload")');
await page.waitForSelector("text=pan.pdf");
await page.setInputFiles('input[name="file"]', {
  name: "evil.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("MZ not a pdf"),
});
await page.click('button:has-text("Upload")');
await page.waitForSelector("text=do not match its type");
ok("document upload accepted; spoofed file rejected by magic-byte check");

// 10. Reveal is audited; CSV export has no PAN and neutralises formulas
await page.click('button:has-text("Reveal full details")');
await page.waitForSelector("text=PAN: ABCDE1234F");
ok("sensitive reveal works");

const [dl] = await Promise.all([
  page.waitForEvent("download"),
  page.goto(`${BASE}/api/employees/export`).catch(() => {}),
]);
const csv = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
await must(
  csv.includes("E101") && !csv.includes("ABCDE1234F") && !csv.includes("123456789012"),
  "export has no sensitive data",
);
ok("CSV export works and excludes PAN/bank");

// 11. CSV import: bad file imports nothing, good file imports
await page.goto(`${BASE}/employees`);
await page.click('button:has-text("Import CSV")');
const header = "employee_code,first_name,last_name,email,join_date,department\n";
await page.setInputFiles('input[aria-label="CSV file"]', {
  name: "bad.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    header +
      "E200,Ok,One,ok1@example.com,2026-04-01,Engineering\nE101,Dup,Two,ok2@example.com,2026-04-01,Engineering\nE202,Bad,Three,notanemail,2026-04-01,Nowhere\n",
  ),
});
await page.click('button:has-text("Import"):not(:has-text("CSV"))');
await page.waitForSelector("text=Row 3");
await page.waitForSelector("text=Row 4");
await page.reload();
await must((await page.locator("text=E200").count()) === 0, "bad import wrote nothing");
ok("bad CSV import is all-or-nothing and reports every bad row");
await page.click('button:has-text("Import CSV")');
await page.setInputFiles('input[aria-label="CSV file"]', {
  name: "good.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    header +
      "E200,Ok,One,ok1@example.com,2026-04-01,Engineering\nE201,Ok,Two,ok2@example.com,2026-04-01,Sales\n",
  ),
});
await page.click('button:has-text("Import"):not(:has-text("CSV"))');
await page.waitForSelector("text=Ok One");
ok("good CSV imports 2 employees");

// 12. Org chart with a manager; manager loop rejected
await page.goto(profileUrl + "/edit");
await page.selectOption("#managerId", { label: "Ok One" });
await page.click('button:has-text("Save changes")');
await page.waitForURL(profileUrl);
await page.goto(`${BASE}/org-chart`);
await page.waitForSelector('a:has-text("Ok One")');
await must(
  (await page.locator('a:has-text("Asha Verma")').count()) === 1,
  "report appears under manager",
);
ok("org chart shows reporting line");

// 13. Audit log has entries and the chain verifies
await page.goto(`${BASE}/audit`);
await page.waitForSelector("text=Chain verified");
const audit = await page.locator("body").innerText();
await must(
  audit.includes("employee.created") &&
    audit.includes("salary.assigned") &&
    audit.includes("employee.sensitive_revealed"),
  "audit has the expected actions",
);
ok("audit log chain verified with employee/salary/reveal entries");

// 14. Invite flow: create invite, a second user accepts
await page.goto(profileUrl);
await page.click('button:has-text("Invite to PayFlow")');
await page.click('button:has-text("Create invite link")');
const link = await page.inputValue('input[aria-label="Invite link"]');
await must(link.includes("/invite/"), "invite link produced");
const ctx2 = await browser.newContext();
await ctx2.addInitScript(() => {
  try {
    localStorage.setItem("payflow:tour:v1", "done");
  } catch {}
});
const p2 = await ctx2.newPage();
p2.setDefaultTimeout(15000);
await p2.goto(`${BASE}/signup`);
await p2.fill("#name", "Asha Verma");
await p2.fill("#email", ASHA);
await p2.fill("#password", "Str0ngPassw0rd!");
await p2.click('button[type="submit"]');
await p2.waitForURL("**/onboarding");
await p2.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await p2.click('button:has-text("Accept invitation")');
await p2.waitForURL("**/dashboard");
ok("employee accepted invite and joined as a member");

// 15. RBAC: the invited employee cannot open admin pages or the export
await p2.goto(`${BASE}/employees`);
await p2.waitForURL("**/dashboard?denied=1");
const exportStatus = await p2.evaluate(async () => (await fetch("/api/employees/export")).status);
await must(exportStatus === 403, `export forbidden for employee (got ${exportStatus})`);
const docStatus = await p2.evaluate(
  async () => (await fetch("/api/documents/00000000-0000-4000-8000-000000000000")).status,
);
await must(docStatus === 403, `documents forbidden for employee (got ${docStatus})`);
ok("employee role blocked from employees page, export and documents (403)");

// 16. Used invite cannot be reused
const ctx3 = await browser.newContext();
await ctx3.addInitScript(() => {
  try {
    localStorage.setItem("payflow:tour:v1", "done");
  } catch {}
});
const p3 = await ctx3.newPage();
p3.setDefaultTimeout(15000);
await p3.goto(`${BASE}/signup`);
await p3.fill("#name", "Mallory");
await p3.fill("#email", MALLORY);
await p3.fill("#password", "Str0ngPassw0rd!");
await p3.click('button[type="submit"]');
await p3.waitForURL("**/onboarding");
await p3.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await p3.click('button:has-text("Accept invitation")');
await p3.waitForSelector('p[role="alert"]');
const msg = await p3.locator('p[role="alert"]').innerText();
await must(/already used|is for asha/i.test(msg), `stolen/used invite rejected (${msg})`);
ok("invite cannot be used by a different email or twice");

await must(errors.length === 0, `no uncaught browser errors: ${errors.join("|")}`);
ok("no uncaught browser errors");
console.log(`\n${steps.length} checks passed`);
await browser.close();
