# PayFlow

AI-powered, automation-first payroll and HR for Indian companies. Built phase by phase; this repo is currently at **Phase 2: organisation, employees and salary structures**.

## Status

| Phase | Scope                                                                             | State |
| ----- | --------------------------------------------------------------------------------- | ----- |
| 1     | Setup, design system, schema, auth, RBAC, multi-tenancy                           | Done  |
| 2     | Org setup, employees, salary structure                                            | Done  |
| 3     | Payroll engine, statutory deductions, payslips, payments                          | Done  |
| 4     | Attendance, leave, expenses, tax declarations, reports                            | Done  |
| 5     | Dashboards, polish, landing page                                                  | Done  |
| 6     | AI layer: PayBot, Payroll Copilot, explainers                                     | Done  |
| 7     | Agentic Copilot, policy RAG, Document AI, voice, generators                       | Done  |
| 8     | Automation, public API, webhooks, live notifications                              | Done  |
| 9     | Simulator, EWA, analytics, engagement, enterprise, privacy, PWA, Hindi, demo seed | Done  |
| 10    | Test coverage, security hardening, performance, CI/CD, documentation              | Done  |

## What Phase 1 includes

- **Next.js 15** (App Router, Server Actions), TypeScript strict, Tailwind v4, Geist, dark/light theme with animated toggle, Cmd+K palette, collapsible sidebar, breadcrumbs, skeletons, error boundaries, reduced-motion support.
- **Auth** with Better Auth: email/password, Google and Microsoft SSO (enabled when keys are set), TOTP 2FA with backup codes.
- **RBAC** for Super Admin, HR Admin, Finance, Manager and Employee. Enforced in middleware (cookie check), in `getContext()` (real session check) and in every server action via `requireActionPermission()`. Maker-checker helper included for payroll approval.
- **Multi-tenancy**: every tenant table carries `organization_id`; a user can belong to many companies and switch between them. The active company cookie is re-validated against memberships on every request.
- **Postgres row-level security** as a second layer: `withTenant(orgId, fn)` sets `app.current_org` per transaction and policies compare against it.
- **Audit log**: append-only (DB triggers block UPDATE/DELETE, even for the owner) and hash-chained, with a verification view at `/audit`.
- **Security basics**: CSP and secure headers, Zod validation, AES-256-GCM helper for sensitive fields, validated env schema, rate limiter (Upstash, in-memory fallback), `/api/health`.
- **Money** is integer paise everywhere (`src/lib/money.ts`).

## What Phase 2 adds

- **Setup wizard**: statutory registrations (PAN, TAN, GSTIN, PF, ESI, PT), departments, designations, pay schedule, holidays.
- **Employees**: profiles with PAN, Aadhaar and bank account encrypted at rest (masked in the UI; revealing is audited), search, filters, pagination, probation tracking, soft delete, org chart with loop prevention.
- **Documents**: PDF/PNG/JPG up to 5 MB, validated by magic bytes, downloads are permission-checked and audited.
- **CSV**: all-or-nothing import reporting every bad row; export excludes sensitive fields and neutralises spreadsheet formulas.
- **Onboarding and offboarding checklists**, plus invitations (single-use, expiring links) so employees can sign in.
- **Salary structures**: reusable components and templates, a pure paise-based engine (fixed, % of CTC, % of Basic, balancing figure), and append-only revision history.

## Setup

```bash
cp .env.example .env            # fill in DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY
npm install
npm run db:generate             # only after schema changes
npm run db:migrate              # apply migrations (as the owner role)
npm run db:rls                  # apply row-level security + audit triggers
npm run dev
```

Generate secrets with `openssl rand -base64 32` (auth secret) and `openssl rand -hex 32` (encryption key).

### Important: run the app as a non-owner database role

Postgres does not apply row-level security to table owners or superusers. Run migrations as the owner, but point the app's `DATABASE_URL` at a non-owner role. `docker/postgres-init.sql` creates `payflow_app` for local development:

```bash
docker compose up db            # Postgres 16 + pgvector with the app role
```

On Neon, create a separate role for the app and grant it table privileges.

## Scripts

`npm run e2e:smoke` drives the real UI in a browser (needs the app running on port 3100 against a non-owner database role).

| Command                 | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run verify`        | typecheck, lint, tests and build in one go                            |
| `npm test`              | unit tests (integration tests skip unless `TEST_DATABASE_URL` is set) |
| `npm run test:coverage` | coverage report                                                       |
| `npm run db:studio`     | Drizzle Studio                                                        |
| `npm run db:seed`       | demo company with 50 employees and 6 months of payroll                |

### Running the integration tests

They exercise tenant isolation, audit chain concurrency and rollback against a real database, connecting as a non-owner role:

```bash
TEST_DATABASE_URL=postgresql://app_user:...@localhost:5432/payflow npm test
```

## Architecture (Phase 1)

```
Browser ──> middleware (session cookie check, CSP headers)
        ──> Server Component / Server Action
              └─ getContext(): session ─> membership ─> role   (validated every request)
              └─ requireActionPermission(perm)                  (server-side RBAC)
              └─ withTenant(orgId, tx => ...)                   (sets app.current_org)
                    └─ Postgres RLS policies + audit triggers
              └─ writeAudit(tx, ...)  hash-chained, same transaction as the change
```

## Known notes

- `npm audit` reports a PostCSS advisory nested inside Next 15 and an esbuild advisory in drizzle-kit (dev tooling only). Fixing the first requires Next 16, which departs from the pinned stack, so it is left for a deliberate upgrade decision.
- The marketing landing page, real dashboards, and other modules are scheduled for later phases; `/` currently routes to login or the dashboard.

## Payroll (Phase 3)

- **Engine** (`src/lib/payroll/`): PF (dated EPFO ceiling, org override), ESI, state Professional Tax tables, TDS for old and new regime (rebate, surcharge with marginal relief, cess), LOP proration, overtime, arrears, bonus, reimbursements, loan EMIs, gratuity, full and final settlement. All money is integer paise.
- **Lifecycle**: draft, review, approve, process, paid. A month can only have one live run (partial unique index); the approver must differ from the preparer and submitter (database CHECK plus server check); items lock once a run leaves draft (trigger); processing locks the run row.
- **Payments**: simulated provider by default; set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` and `RAZORPAY_WEBHOOK_SECRET` to use RazorpayX. The Razorpay adapter has not been exercised against a live account: test it in Razorpay test mode first. Webhook: `/api/webhooks/razorpay` (HMAC verified, de-duplicated).
- **Statutory data to verify before real use**: PF ceiling change date (Sep 2026), Professional Tax slabs (`src/lib/payroll/pt.ts`, each state has a note), surcharge and slab rates.

## Attendance, leave, expenses, tax and reports (Phase 4)

- **Attendance** (`/attendance`): self check-in/out with an optional geo-fence, shifts and roster, HR manual corrections (audited, IST companies only), and a per-month **lock**. Locking marks working days with no record or leave as absent, and a database trigger freezes that month. Payroll takes loss-of-pay and overtime from attendance only for locked months.
- **Leave** (`/leave`): types and balances per financial year (prorated, with carry-forward), half days, overlap and balance checks. HR decides any request; a manager decides only for direct reports; nobody decides their own. Unpaid approved leave counts as loss of pay.
- **Expenses** (`/expenses`): claims with receipts (PDF/PNG/JPG, 5 MB, content-checked; required above Rs 500). Approved claims are added to the next payroll run's reimbursement and marked paid when the run is processed.
- **Tax** (`/tax`): old-regime declarations (80C, 80D, HRA, other) verified by HR, feeding TDS; regime comparison; annual tax summary PDF.
- **Compliance** (`/compliance`): PF/ESI/PT/TDS calendar with due dates, challan tracking, and CSV reports per approved month.
- **Reports** (`/reports`): cost trend, department cost, headcount, attrition, overtime and year over year, exported to Excel and PDF (each export is audited).

Honest limits: compliance reminders are in-app and sent when someone opens the app, not by a scheduler (that arrives with background jobs in Phase 8). The Form 16 download is a **summary**, not the TRACES-signed certificate. PT due dates use a generic default (15th of the next month). 80D is modelled as Rs 25,000 + Rs 25,000 without senior-citizen limits. Overtime pay is Basic/26/8 x 2.

E2E: `node tests/e2e/phase4-smoke.mjs` (needs the app and the throwaway Postgres, like the Phase 2 and 3 scripts).

## Dashboards, polish and landing page (Phase 5)

- **Dashboards** (`/dashboard`): one page, up to three views chosen by what you are allowed to see: **Company** (HR, Finance, admins), **My team** (anyone with direct reports) and **Me** (anyone with an employee record).
  - Company: animated KPIs (payroll cost, headcount, pending approvals, TDS deducted), cost trend, department donut, payroll countdown from the company's cutoff and pay day, activity feed from the audit log, insights, quick actions.
  - Team: today's attendance, approvals waiting, team cost (needs `team:cost`), and attendance patterns (4+ late arrivals or 3+ absences in 30 days).
  - Me: latest net pay and history, leave balances, tax summary with tax-saving pointers worked out from your own declaration, payslip download.
  - Announcements are shared by all views. HR and admins post them (`announcements:manage`), optionally pinned, expiring, and notified to everyone.
- **Shell:** page transitions, a notification bell (unread count, mark read), a mobile navigation drawer, personal accent colours, a first-run product tour (also in the command palette), illustrated empty states, skeleton loaders, and more command-palette actions.
- **Landing page** (`/`): server-rendered hero, a live sample-data preview built from the real dashboard components, feature bento, pricing, FAQ. Pricing is illustrative and says so. There are deliberately no customer testimonials or logos, because there are no customers to quote.
- Charts are inline SVG with no chart library, so they stay small and accessible (each has a text equivalent for screen readers).

Honest limits: insights are rule-based checks over your data, not AI (PayBot arrives in Phase 6). The manager view shows attendance patterns, not a predictive attrition score (Phase 9). The employee recognition wall belongs with gamification in Phase 9. Notifications refresh on page load and after actions; live push (SSE) comes with the automation work in Phase 8.

E2E: `node tests/e2e/phase5-smoke.mjs`.

## Phase 6: AI layer (PayBot, Payroll Copilot, explainers)

**What it does**

- **PayBot**: a floating, streaming, role-aware assistant (also reachable from Cmd+K → "Ask PayBot"). Markdown replies, tool-status chips, source cards, charts, suggested follow-ups, thumbs up/down, conversation history.
- **Safe tool calling**: the model can only call 11 read-only, permission-scoped server functions (`src/lib/ai/tools.ts`). No tool takes an employee id or a query, permissions are re-checked on the server at call time, arguments and outputs are Zod-validated, and the model never sees raw SQL or other people's data.
- **Payroll Copilot** on draft/review runs: pre-approval checklist (pass/warn/fail with fix links) and anomaly detection (salary spikes, duplicate bank accounts, abnormal deductions, ghost employees). Each flag explains itself with numbers and a suggestion; reviewers can mark one as expected with a reason (audited) and restore it.
- **Payslip explainer** (English or Hindi) on `/payslips`, own payslip only. Model output is Zod-validated and every rupee figure must exist on the payslip or the answer is discarded.
- **Natural-language reports** ("attrition by department") render as charts in chat.
- **Guardrails**: prompt-injection and jailbreak refusal, tool-output sanitising, PII masking (PAN, Aadhaar, IFSC, email, phone, account numbers) before anything is stored or sent to a model, 20 messages/min per user, a daily token budget (`AI_DAILY_TOKEN_LIMIT`), usage and estimated-cost logging per call (`ai_usage`), and graceful fallback when the AI service fails.

**Configuration**: set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`). Without a key, or if Gemini errors, PayBot and the explainer use a built-in deterministic engine that routes to the same permission-checked tools.

**Honest limits**

- The Gemini path could not be exercised live in the build sandbox (no network to Google). It is unit-tested against the SDK's shapes; the end-to-end tests run on the built-in engine. Try it with a real key before relying on it.
- The built-in engine is keyword-based and English-only. Anomaly explanations are deterministic, not LLM-written.
- Cost figures are estimates from token counts.
- Rate limiting is per-process unless Upstash is configured.
- PayBot is read-only; agentic actions arrive in Phase 7.
- Fixed in passing: month-end dates were hard-coded to the 31st in three queries (broke 30-day months), and charts no longer receive functions from server components (employee dashboard crashed once a payslip existed).

## Phase 7: Agentic Copilot, policy RAG, Document AI, voice, generators

**Agentic Copilot (PayBot actions).** The model can only _propose_: `propose_approve_leave`, `propose_reject_leave`, `propose_create_payroll_draft`, `propose_department_raise`, `propose_cancel_payroll_run`. A proposal is saved server-side (`ai_actions`, 15-minute expiry) and shown as a confirm card listing exactly what will change. Only **Confirm** runs it, using the stored parameters (the client cannot alter them), via the same domain code as the normal screens (permission checks, validation, audit). Rules:

- Needs `ai:act` plus the underlying permission (employees never see action tools).
- Destructive actions (department raise, cancel run) also need the typed word `CONFIRM`.
- The row is claimed atomically, so a double click or second tab cannot run it twice; a raise re-checks each salary hasn't changed since the preview and applies all-or-nothing as append-only revisions.
- Every execution writes `ai.action.executed` / `.failed` / `.cancelled` to the audit chain, in addition to the domain entry (e.g. `leave.approved`).

**Policy RAG.** HR uploads PDF/.txt/.md (`/policies`); text is extracted per page, chunked (~900 chars, overlap), embedded with Gemini `gemini-embedding-001` (768-d) when a key is set, and stored with pgvector when the extension exists (`drizzle/rls.sql` adds the `embedding` column and HNSW index if it can). Search uses cosine distance when vectors exist, otherwise Postgres full-text search with a relevance filter so unrelated questions return nothing. Answers cite the document and page and link to the passage. Employees can read policies; only `policies:manage` can upload or delete.

**Document AI** (`/documents`, HR). Upload PAN, Aadhaar, bank proof or resume (JPG/PNG/WebP/PDF, checked by content). Gemini Vision reads the fields; a person must verify before anything is saved. Values are validated (PAN format, Aadhaar Verhoeff checksum, IFSC, account number) and encrypted at rest; the uploaded file is not stored. Nothing is applied automatically.

**Voice.** PayBot has a mic button (Web Speech API) in English or Hindi and optional read-aloud. **Generators** (`/generators`): offer letter, appointment letter, job description, announcement email, from structured inputs.

**Honest limits**

- Gemini (chat, embeddings, Vision, generators) cannot be reached from the build sandbox, so those paths are unit-tested against SDK shapes and run live only in fallback mode. Without a key: PayBot uses its keyword engine, Document AI is manual entry with the same verification step, generators fill standard templates (facts verified), policy search is keyword-only. Try with a real key before relying on it.
- pgvector could not be installed in the sandbox, so the semantic-search SQL (`<=>`) is untested here; keyword search is tested end to end.
- Browser voice depends on the browser's Web Speech support (best in Chrome/Edge; Hindi quality varies) and needs a real microphone, which tests cannot supply; only the toggles are tested.
- The built-in engine understands a fixed set of action phrases in English.
- Generated letters are drafts, not legal advice. Scanned PDFs have no text and are refused for policies.
- Coverage is still below the 80% target (Phase 10).

## Phase 8: automation, public API, webhooks, live notifications

**Visual workflows** (`/workflows`, `workflows:manage`). A React Flow canvas with one trigger (`leave.applied`, `payroll.approved`, `employee.joined`, `deadline.near`), condition branches (yes/no), and actions: email, Slack, Teams, WhatsApp, webhook, in-app notification, task, and approval. `{{employee.name}}`-style placeholders fill in event data. The graph is validated live and again on the server (one trigger, no loops, nothing orphaned, every step configured); an incomplete automation cannot be turned on. Eight ready templates ship. **Test run** executes it once with clearly marked sample data.

- Each run keeps a step-by-step log. Failed steps retry 3 times with backoff; a failed run notifies admins and can be retried, and finished steps are never repeated.
- An approval step pauses the run and creates an approval in "Waiting for you"; approving or rejecting resumes the matching branch (the decision is claimed once and cannot be replayed).
- Triggers are recorded in the same transaction as the business change (leave, employee, payroll approval) so an automation never reacts to a rolled-back change. A dedupe key makes repeated events (deadline sweeps) idempotent.

**Background jobs.** The engine is plain functions that Inngest wraps (`src/inngest`, served at `/api/inngest`) when `INNGEST_EVENT_KEY` is set. Without it, work runs right after the response and `GET /api/cron/tick` (Bearer `CRON_SECRET`) sweeps stranded runs and due webhook retries; point any scheduler at it every 5 minutes. Database rows are the source of truth, so a crash cannot lose work.

**Automatic payroll** (`/workflows/pipeline`). Each month: lock attendance, create the draft, run the anomaly and pre-run checks, submit for approval, remind approvers after N hours, tell employees once payroll is processed. Each step is recorded once and never repeated. It stops and says why (for example, no salaries, a failing check, or a high-severity anomaly). It acts as a per-company system user, so the maker-checker rule still requires a human approver, and payment is always started by a person.

**Public API** (`/api/v1`, keys at `/developers`). Read-only: employees, payroll runs, leave requests, attendance. Bearer keys (`pf_live_…`) are shown once and stored only as a SHA-256 hash; each has scopes, a per-minute rate limit (429 with `Retry-After`, `X-RateLimit-*` headers), optional expiry, and instant revocation. Responses use explicit field allow-lists: bank, PAN, Aadhaar, UAN and ESI numbers never leave. Amounts are integer paise. Spec at `/api/v1/openapi.json`.

**Webhooks.** Endpoints subscribe to events (`leave.applied`, `payroll.approved`, `employee.joined`, `deadline.near`, `payroll.paid`). Bodies are signed with HMAC-SHA256 over `timestamp.body` (`X-PayFlow-Signature`, 5-minute replay window, example verifier on the Developers page). The signing secret is encrypted at rest and shown once. Failed deliveries retry (1m, 5m, 30m, 2h, 8h), then show as failed with a Resend button. Outbound calls (webhooks, Slack, Teams) refuse non-https URLs and any address that resolves to a private, loopback, link-local or metadata range, and never follow redirects.

**Live notifications.** The bell uses server-sent events (`/api/notifications/stream`, resumable with `Last-Event-ID`) instead of refreshing on page load.

**Honest limits**

- Inngest, Resend and the WhatsApp Cloud API cannot be reached from the build sandbox. The Inngest functions wrap the same tested code but were not run against Inngest itself. Without Resend/WhatsApp keys those steps are recorded as "skipped (not configured)" rather than pretending to send. Slack/Teams posting is covered by the same guarded HTTP client as webhooks, which is tested against a local receiver, not the real services.
- `payroll.paid` webhooks are queued when the run settles and delivered on the next sweep (minutes), not instantly.
- The SSE stream polls the database every 4 seconds per open tab; it is not a push from Postgres.
- Employee "e-sign" and bank-verification onboarding steps are tasks for a person, not a legal e-signature or bank-verification service.
- `ALLOW_PRIVATE_WEBHOOKS=1` disables the private-network guard for local end-to-end tests only.
- Coverage is still below the 80% target (Phase 10).

## Phase 9: advanced features

**Employee tools.** `/simulator` runs the real payroll engine for all 12 months of the financial year in both tax regimes, so take-home and the better regime are what payroll would produce. `/ewa` (earned wage access) lets an employee draw part of pay already earned this month. An approved request becomes a one-instalment `advance` loan that normal payroll recovers; the approver cannot be the requester and limits are re-checked at approval. **No money moves: the payout is a mock and the page says so.** `/recognition` shows a streak (working days attended in a row; weekly offs, holidays and approved leave neither add nor break it), 8 badges derived from real attendance and recognition (never stored), and peer recognition (5 a day). `/surveys` has anonymous pulse surveys.

**Analytics (`/analytics`).** Cost forecast for 6 months with hires, increments and attrition. Attrition risk is a transparent rule-based score with listed factors, **not a trained model**; managers see only their direct reports. Pay equity shows unadjusted and like-for-like gaps and suppresses any group under 3 people. Salary benchmarks are entered by the company; **no market data is bundled**.

**Survey anonymity.** Who answered (`survey_participation`) and what was answered (`survey_responses`) are separate tables; responses hold no user, no employee and only the date. Results appear only at 5 or more responses, small departments are hidden, comments are shuffled, and no audit entry names a respondent. The sentiment label is a simple word-list scorer (English plus Roman Hindi): a rough signal, not analysis.

**Enterprise (`/settings/enterprise`, needs `org:manage`).**

- _Single sign-on:_ list email domains that must use Google or Microsoft; password sign-in and sign-up are refused for them (enforced in the auth layer through a one-question database function). **SAML is not implemented**: it needs a real identity provider to verify, and Google/Microsoft only work when their client ids are set.
- _Feature flags:_ EWA, recognition, surveys, pay equity and PayBot can be switched off per company. Pages render the not-found screen, server actions refuse, and the PayBot API returns 403. (The not-found page is streamed, so the HTTP status can still read 200.)
- _White-label:_ product name and https logo link replace "PayFlow" in the app header. Payslips and emails still carry the company name and colour from Company profile; they do not use the product name.
- _Multi-currency:_ display only. The company enters its own rates and the simulator adds an indicative foreign-currency line. Payroll, payslips and statutory returns are always INR.

**Privacy (`/privacy`).** Anyone can download their own data as JSON (PAN, Aadhaar and bank numbers masked to the last four characters; receipt images and uploaded documents are not embedded). Erasure is a request that HR reviews. It can only be approved after the employee has exited; approval removes name, contact, ids, bank details, documents and receipt images, and deactivates the login. Payroll amounts, tax records and the audit log are kept because statutory retention requires it, and the page says so.

**PWA and offline attendance.** `/manifest.webmanifest`, generated icons, a service worker (`public/sw.js`) that caches only hashed static assets and shows `/offline.html` when a page cannot load, and an "Install app" button. A check-in or check-out made offline is stored in IndexedDB with the real time and location, then sent when the device is back online (the `online` event, and Background Sync where the browser supports it). The server accepts a punch time only if it is not in the future and not older than 48 hours, records the source as `offline`, and still applies the geo-fence. Personal pages are never cached. `next-pwa` was not used: the custom worker is smaller and does exactly this.

**Languages.** English and Hindi via `next-intl`, chosen per person (cookie, switch in the account menu) with the company default as fallback. **Only the app shell (navigation, breadcrumbs, account menu), the attendance panel and the privacy page are translated so far; other screens remain English.** The Hindi strings were written without a native reviewer and should be checked before production use. A test keeps both catalogues in step.

**Demo data.** `npm run db:seed` (needs `DATABASE_URL` on a migrated database with RLS applied) creates "Brightwave Technologies": 50 employees across 6 departments, salaries assigned through the real assignment code, about 6,000 attendance records, leave, expenses, 6 months of paid payroll runs produced by the real engine, three sample policies (keyword-indexed, no embeddings), recognition, an open survey with responses, EWA enabled, and salary benchmarks. Logins: `admin@`, `hr@`, `finance@`, `manager@`, `employee@payflow.demo`, password `PayFlowDemo#2026`. Run `npm run db:seed -- --reset` to rebuild. It is deterministic and refuses to run twice. Change or delete those passwords before using the database for anything real.

**Not verified here:** SAML, Google/Microsoft sign-in with real credentials, Gemini, Inngest and Resend (unreachable from the build sandbox), installing the PWA on a real phone, and the Hindi copy with a native speaker.

## Phase 10: quality, security, performance, delivery

**Tests.** 512 tests in 43 files (unit, integration against a real Postgres as a non-owner role, seeded-company invariants). Coverage with the database attached: 81% statements, 83% lines, 79% functions, 68% branches. `vitest.config.ts` enforces floors (80 / 80 / 75 / 60) so CI fails if coverage drops. Integration tests need two URLs: `TEST_DATABASE_URL` (the app role, so row-level security is exercised) and `TEST_DATABASE_OWNER_URL` (table owner, used only to seed and clean up, because immutability triggers block deletes for everyone else). Without them the database tests skip and coverage is lower. `tests/unit/access-guards.test.ts` fails the build if any server action, API route or admin page is added without a permission or session guard.

**Browser tests.** `tests/e2e/phase2..9-smoke.mjs` drive the real UI. They need `playwright`, a seeded database and the app running on port 3100. Sign-in and sign-up are rate limited (3 sign-ins per 10 s and 5 sign-ups per 60 s per IP, stored in the database), so the scripts pause between runs. Phase 9's run also fails on any Content-Security-Policy violation.

**Security.**

- _CSP:_ nonce-based (`src/lib/csp.ts`, set per request in `src/middleware.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, no `unsafe-inline` for scripts, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. Styles still allow `unsafe-inline` because the UI libraries inject style attributes. Other headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`. Because every page now carries a per-request nonce, pages are rendered on demand rather than statically cached.
- _Rate limits:_ Better Auth limits are stored in Postgres so they hold across instances (100 requests per minute overall; sign-in, sign-up and TOTP verification are stricter). API keys, webhooks and PayBot have their own limits.
- _Access control:_ every server action goes through `runAction` (permission check, transaction, audit entry) and row-level security is the second layer. One unguarded action (`csvTemplateAction`) was found and fixed during this phase.
- _Dependency audit:_ `npm audit --omit=dev` reports no critical issues; CI fails on critical. Known and accepted: `inngest` pulls a `zod` version with a high advisory (no upstream fix at the time of writing; the affected code path parses only our own event payloads), `exceljs` pulls an old `uuid` (moderate, not used with attacker-controlled buffers), and `drizzle-kit`'s `esbuild` is a development tool that never ships. `postcss` is pinned through `overrides`, and `next` is pinned to 15.5.29. Re-check these before every release.
- _Secrets:_ a scan of the tree found none committed. `.env.example` is tracked; real `.env*` files are ignored.

**Performance.** Every route's first-load JS is 104-250 kB (shared 103 kB); the heaviest are the payroll run page (250 kB, charts and animation) and the workflow builder (218 kB, React Flow, loaded only there). Tenant tables that lack an `organization_id`-leading index (`leave_balances`, `loan_repayments`, `tax_declarations` and a few others) are always queried through a parent id that their unique index leads with, so no extra index was added. Lighthouse (desktop preset, production build, local): landing 96-98 performance, login and sign-up 100; accessibility 100, SEO 100, best practices 96-100 on all three. LCP is under one second. `lighthouserc.json` asserts accessibility and best practices >= 0.9 (error) and performance / SEO (warning); authenticated pages were not audited by Lighthouse.

**CI/CD (`.github/workflows/ci.yml`).** On every push and pull request: format check, lint (zero warnings), typecheck, `npm audit`, migrations plus RLS applied to a pgvector Postgres with a non-owner app role, tests with coverage thresholds, production build, a seeded browser smoke test (Phase 9 flow, including CSP), Lighthouse CI on the public pages, then a Docker job that builds the image and checks that it boots. The workflow was written and each command was run locally, but it has **not** run on GitHub.

**Docker.** `docker compose up` starts Postgres 16 with pgvector and the app image (multi-stage, standalone output, non-root, health check on `/api/health`). Run migrations and `npm run db:rls` as the owner role first (see Setup); the app connects as the non-owner `payflow_app` role. The build stage uses a placeholder auth secret that is not copied into the final image, which needs real values in `.env` at runtime.

**Not verified in this environment.** The GitHub Actions run itself, building the Docker image (the Docker CLI is installed here but there is no daemon; the standalone server the image runs, `node .next/standalone/server.js`, was booted and served `/login` with its CSP and a healthy `/api/health`), Gemini, Inngest and Resend delivery, Razorpay beyond test-mode simulation, SAML (not implemented), the PWA on a real phone, and the Hindi copy with a native reviewer. The Phase 5 notification-bell E2E step failed intermittently (2 of 4 runs) with the bell still showing one unread after "Mark all read", then passed twice with no code change; the action itself works when run alone, so a race between the live-notification refresh and the read refresh is the likely cause and has not been fixed.

### Forgot and reset password

- Sign-in has a "Forgot password?" link to `/forgot-password`. The reply is always the same neutral message, whether or not the email has an account, so nobody can probe for accounts.
- The link in the email opens `/reset-password`, works once and expires after 60 minutes. A new password must meet the same rule as sign-up (checked in the form and again on the server). A successful reset signs the account out everywhere.
- Companies that enforce single sign-on cannot request a reset by password.
- Email goes through Resend: set `RESEND_API_KEY` and `RESEND_FROM`. In development without a key the link is printed in the server console. In production without a key nothing is logged and no mail is sent.
- Limits: 3 reset requests and 5 reset attempts per minute per address/IP.
- Session checks now skip the 5-minute cookie cache (one extra lookup per request) so a revoked session ends at once. `/login` and `/signup` send signed-in people to the app from the page, not from middleware, so a stale cookie cannot cause a redirect loop.
- Not verified: real delivery through Resend (needs your key). On serverless hosts the unawaited send may be cut short; use Node or Docker hosting, or await it.
- E2E: `node tests/e2e/password-reset-smoke.mjs` (needs `E2E_DATABASE_URL` owner connection).
