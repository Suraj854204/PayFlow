<div align="center">

# PayFlow

**AI-powered, automation-first payroll and HR for Indian companies.**

Statutory-compliant payroll, multi-tenant HR, an agentic AI copilot, workflow automation and a public API, in one codebase.

[**Live Demo**](https://payflow-five-nu.vercel.app/) · [Features](#features) · [Architecture](#architecture) · [Getting Started](#getting-started) · [Security](#security) · [Known Limitations](#known-limitations)

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-4169E1?logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-512%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-81%25-brightgreen)
![Lighthouse](https://img.shields.io/badge/Lighthouse-96--100-brightgreen)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Live Demo](#live-demo)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Testing](#testing)
- [Security](#security)
- [Performance](#performance)
- [CI/CD and Deployment](#cicd-and-deployment)
- [Public API and Webhooks](#public-api-and-webhooks)
- [Project Status](#project-status)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [Author](#author)

---

## Overview

PayFlow runs the full monthly payroll cycle for Indian companies: organisation setup, employee records, salary structures, attendance and leave, statutory deductions (PF, ESI, Professional Tax, TDS), payslips, payments and compliance tracking. On top of that sits an AI layer and an automation layer that remove repetitive work while keeping a human in control of every consequential action.

Design principles:

- **Money is integer paise everywhere.** No floating point in any payroll path (`src/lib/money.ts`).
- **Tenant isolation in two layers.** Application-level membership checks plus Postgres row-level security.
- **Humans approve, machines prepare.** Maker-checker on payroll; the AI can only *propose* actions, never execute them.
- **Honest by design.** Anything simulated, unverified or not implemented is called out in the UI and in this document.

## Live Demo

**https://payflow-five-nu.vercel.app/**

If the demo database has been seeded (`npm run db:seed`), you can sign in with the demo accounts below. The seed creates *Brightwave Technologies* with 50 employees, about 6,000 attendance records and 6 months of paid payroll.

| Role        | Email                  |
| ----------- | ---------------------- |
| Super Admin | `admin@payflow.demo`   |
| HR Admin    | `hr@payflow.demo`      |
| Finance     | `finance@payflow.demo` |
| Manager     | `manager@payflow.demo` |
| Employee    | `employee@payflow.demo`|

Password for all demo accounts: `PayFlowDemo#2026`

> **Warning:** these credentials are public. Change or delete them before using the database for anything real.

## Features

### Foundation

- **Authentication** via Better Auth: email/password, Google and Microsoft SSO (enabled when keys are set), TOTP two-factor with backup codes, forgot/reset password.
- **RBAC** for Super Admin, HR Admin, Finance, Manager and Employee, enforced in middleware, in `getContext()` and in every server action through `requireActionPermission()`.
- **Multi-tenancy**: every tenant table carries `organization_id`; users can belong to many companies and switch between them. The active-company cookie is re-validated against memberships on every request.
- **Tamper-evident audit log**: append-only (database triggers block UPDATE and DELETE, even for the table owner) and hash-chained, with a verification view at `/audit`.
- **UX**: dark/light theme, Cmd+K command palette, collapsible sidebar, skeleton loaders, error boundaries, reduced-motion support, English and Hindi.

### Organisation, employees and salary

- **Setup wizard**: PAN, TAN, GSTIN, PF, ESI and PT registrations, departments, designations, pay schedule, holidays.
- **Employee records**: PAN, Aadhaar and bank details encrypted at rest (AES-256-GCM), masked in the UI, with audited reveal. Search, filters, pagination, probation tracking, soft delete and an org chart with loop prevention.
- **Documents**: PDF/PNG/JPG up to 5 MB, validated by magic bytes, permission-checked and audited downloads.
- **CSV import/export**: all-or-nothing import that reports every bad row; exports omit sensitive fields and neutralise spreadsheet formulas.
- **Onboarding and offboarding** checklists and single-use, expiring invitations.
- **Salary structures**: reusable components and templates; a pure paise-based engine supporting fixed, % of CTC, % of Basic and balancing-figure components; append-only revision history.

### Payroll engine

- PF (dated EPFO ceiling, organisation override), ESI, state-wise Professional Tax, TDS for old and new regimes (rebate, surcharge with marginal relief, cess), LOP proration, overtime, arrears, bonus, reimbursements, loan EMIs, gratuity, and full-and-final settlement.
- **Lifecycle**: draft → review → approve → process → paid. One live run per month (partial unique index); the approver must differ from the preparer and submitter (database CHECK plus server check); items lock once a run leaves draft; processing locks the run row.
- **Payments**: simulated provider by default; RazorpayX adapter with HMAC-verified, de-duplicated webhooks.

### Attendance, leave, expenses, tax and compliance

- **Attendance**: self check-in/out with optional geo-fence, shifts and rosters, audited HR corrections, and a monthly lock enforced by a database trigger. Payroll reads LOP and overtime only from locked months.
- **Leave**: types and balances per financial year (prorated, carry-forward), half days, overlap and balance checks, and approval rules (no self-approval; managers decide only for direct reports).
- **Expenses**: claims with content-checked receipts, folded into the next payroll run automatically.
- **Tax**: old-regime declarations (80C, 80D, HRA, other) verified by HR, regime comparison, annual tax summary PDF.
- **Compliance**: PF/ESI/PT/TDS calendar, challan tracking, CSV reports per approved month.
- **Reports**: cost trend, department cost, headcount, attrition, overtime and year-over-year, exported to Excel and PDF (each export audited).

### Dashboards

Role-aware views (**Company**, **My team**, **Me**) with animated KPIs, cost trend, department breakdown, payroll countdown, activity feed, insights, announcements and a first-run product tour. Charts are inline SVG with screen-reader text equivalents and no chart library.

### AI layer

- **PayBot**: streaming, role-aware assistant with Markdown replies, tool-status chips, source cards, in-chat charts, voice input (English/Hindi) and read-aloud.
- **Safe tool calling**: 11 read-only, permission-scoped server functions. No tool accepts an employee id or a free-form query; arguments and outputs are Zod-validated.
- **Agentic Copilot**: the model can only *propose* actions (approve/reject leave, create payroll draft, department raise, cancel run). A proposal is stored server-side with a 15-minute expiry and shown as a confirmation card. Only **Confirm** executes it, from the stored parameters, through the same domain code and audit trail as the normal screens. Destructive actions need a typed `CONFIRM`. Execution is claimed atomically, so double clicks cannot run it twice.
- **Payroll Copilot**: pre-approval checklist and anomaly detection (salary spikes, duplicate bank accounts, abnormal deductions, ghost employees) with explanations and an audited "mark as expected" flow.
- **Payslip explainer** (English or Hindi): output is Zod-validated and every rupee figure must exist on the payslip, otherwise the answer is discarded.
- **Policy RAG**: upload PDF/TXT/MD policies; chunked, embedded (Gemini `gemini-embedding-001`, 768-d) and stored in pgvector, with Postgres full-text search as fallback. Answers cite document and page.
- **Document AI**: Gemini Vision extraction from PAN, Aadhaar, bank proof and resumes, with mandatory human verification and checksum validation before anything is saved.
- **Generators**: offer letters, appointment letters, job descriptions, announcement emails.
- **Guardrails**: prompt-injection and jailbreak refusal, tool-output sanitising, PII masking before storage or model calls, per-user rate limits, a daily token budget, per-call usage and cost logging, and graceful fallback to a deterministic engine when no key is set or the service fails.

### Automation and integrations

- **Visual workflow builder** (React Flow) with triggers, conditions and actions (email, Slack, Teams, WhatsApp, webhook, in-app notification, task, approval). Graphs are validated live and again on the server. Runs keep step logs, retry with backoff and never repeat completed steps.
- **Automatic payroll pipeline**: lock attendance, create draft, run checks, submit for approval, remind approvers, notify employees. A human approver is still required and payment is always started by a person.
- **Background jobs**: Inngest when configured; otherwise an authenticated cron endpoint sweeps stranded runs and due retries.
- **Public API** (`/api/v1`) with scoped, rate-limited, revocable API keys and an OpenAPI spec.
- **Signed webhooks** with retries and manual resend.
- **Live notifications** over server-sent events.

### Employee and enterprise features

- **Salary simulator** using the real payroll engine across both tax regimes.
- **Earned wage access** (mock payout), **recognition** (streaks, badges, peer kudos) and **anonymous pulse surveys** with structural anonymity.
- **Analytics**: cost forecast, transparent rule-based attrition risk, pay equity with small-group suppression, company-entered salary benchmarks.
- **Enterprise settings**: SSO domain enforcement, per-company feature flags, white-label branding, display-only multi-currency.
- **Privacy**: personal data export and a reviewed erasure workflow that respects statutory retention.
- **PWA** with offline attendance queue (IndexedDB) and background sync.

## Tech Stack

| Layer          | Technology                                                                         |
| -------------- | ---------------------------------------------------------------------------------- |
| Framework      | Next.js 15 (App Router, Server Actions), React, TypeScript (strict)                |
| Styling        | Tailwind CSS v4, Geist                                                              |
| Database       | PostgreSQL 16 with pgvector, Drizzle ORM, row-level security                       |
| Auth           | Better Auth (email/password, Google, Microsoft, TOTP 2FA)                          |
| Validation     | Zod                                                                                 |
| AI             | Google Gemini (chat, embeddings, vision) with a deterministic built-in fallback    |
| Jobs           | Inngest, with a cron-based fallback                                                 |
| Payments       | RazorpayX (simulated provider by default)                                           |
| Email          | Resend                                                                              |
| Rate limiting  | Upstash Redis with in-memory fallback; Postgres-backed auth limits                  |
| Workflows      | React Flow                                                                          |
| i18n           | next-intl (English, Hindi)                                                          |
| Testing        | Vitest, Playwright, Lighthouse CI                                                   |
| Delivery       | GitHub Actions, Docker (multi-stage, standalone output), Vercel                    |

## Architecture

```
Browser ──> middleware (session cookie check, nonce-based CSP)
        ──> Server Component / Server Action
              └─ getContext(): session ─> membership ─> role    (validated every request)
              └─ requireActionPermission(perm)                   (server-side RBAC)
              └─ runAction(): permission + transaction + audit
              └─ withTenant(orgId, tx => ...)                    (sets app.current_org)
                    └─ Postgres RLS policies + immutability triggers
              └─ writeAudit(tx, ...)   hash-chained, same transaction as the change
```

Key decisions:

- **RLS as a second layer.** `withTenant()` sets `app.current_org` per transaction and policies compare against it. The app must connect as a **non-owner** role, because Postgres does not apply RLS to table owners.
- **Audit in the same transaction.** A rolled-back change never leaves an audit entry, and an audit entry never exists without its change.
- **Database is the source of truth for automation.** Events are recorded in the same transaction as the business change and deduplicated, so a crash cannot lose or duplicate work.
- **AI proposes, humans dispose.** The model has no write path. Confirmed actions run stored parameters through ordinary domain code.

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (pgvector recommended), or Docker
- npm

### Installation

```bash
git clone <your-repository-url>
cd payflow

cp .env.example .env        # fill in DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY
npm install

npm run db:generate         # only after schema changes
npm run db:migrate          # apply migrations (as the owner role)
npm run db:rls              # apply row-level security and audit triggers
npm run dev
```

Generate secrets:

```bash
openssl rand -base64 32     # BETTER_AUTH_SECRET
openssl rand -hex 32        # ENCRYPTION_KEY
```

### Database roles (important)

Run migrations as the table owner, but point the app's `DATABASE_URL` at a **non-owner role**. Otherwise row-level security is silently bypassed.

```bash
docker compose up db        # Postgres 16 + pgvector; creates the payflow_app role
```

On Neon or another managed provider, create a separate application role and grant it table privileges.

### Seed demo data

```bash
npm run db:seed             # deterministic; refuses to run twice
npm run db:seed -- --reset  # rebuild from scratch
```

### Docker

```bash
docker compose up
```

Starts Postgres 16 with pgvector and the application image (multi-stage, standalone output, non-root user, health check on `/api/health`). Run migrations and `npm run db:rls` as the owner role first, and supply real secrets in `.env`.

## Configuration

Copy `.env.example` for the complete list. Commonly used variables:

| Variable                                   | Required | Purpose                                                              |
| ------------------------------------------ | -------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                             | Yes      | Postgres connection for the app (non-owner role)                     |
| `BETTER_AUTH_SECRET`                       | Yes      | Session and auth signing secret                                      |
| `ENCRYPTION_KEY`                           | Yes      | 32-byte hex key for AES-256-GCM field encryption                     |
| `GEMINI_API_KEY`, `GEMINI_MODEL`           | No       | Enables Gemini for PayBot, embeddings, Vision and generators         |
| `AI_DAILY_TOKEN_LIMIT`                     | No       | Daily token budget for AI features                                   |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`   | No       | RazorpayX payments (otherwise simulated)                             |
| `RAZORPAYX_ACCOUNT_NUMBER`                 | No       | RazorpayX account                                                    |
| `RAZORPAY_WEBHOOK_SECRET`                  | No       | Verifies `/api/webhooks/razorpay`                                    |
| `INNGEST_EVENT_KEY`                        | No       | Enables Inngest; otherwise use `GET /api/cron/tick`                  |
| `CRON_SECRET`                              | No       | Bearer token protecting `/api/cron/tick`                             |
| `RESEND_API_KEY`, `RESEND_FROM`            | No       | Transactional email, including password reset                        |
| `ALLOW_PRIVATE_WEBHOOKS`                   | No       | Set to `1` only for local E2E; disables the SSRF guard               |

Google and Microsoft SSO client IDs and Upstash credentials are also read from the environment; see `.env.example` for the exact names.

Features degrade gracefully: without `GEMINI_API_KEY`, PayBot uses a keyword engine, Document AI becomes manual entry with the same verification step, and policy search is keyword-only. Without Resend or WhatsApp keys, those workflow steps are recorded as "skipped (not configured)".

## Scripts

| Command                 | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run dev`           | Start the development server                                          |
| `npm run build`         | Production build                                                      |
| `npm run verify`        | Typecheck, lint, tests and build in one go                            |
| `npm test`              | Unit tests (integration tests skip unless database URLs are set)      |
| `npm run test:coverage` | Coverage report with enforced thresholds                              |
| `npm run db:generate`   | Generate migrations after schema changes                              |
| `npm run db:migrate`    | Apply migrations (owner role)                                         |
| `npm run db:rls`        | Apply row-level security and audit triggers                           |
| `npm run db:studio`     | Drizzle Studio                                                        |
| `npm run db:seed`       | Demo company with 50 employees and 6 months of payroll                |
| `npm run e2e:smoke`     | Browser smoke test (app on port 3100, non-owner database role)        |

## Testing

**512 tests across 43 files**: unit, integration against a real Postgres as a non-owner role, and seeded-company invariants.

Coverage (with database attached): **81% statements, 83% lines, 79% functions, 68% branches.** `vitest.config.ts` enforces floors of 80 / 80 / 75 / 60, so CI fails if coverage drops.

```bash
# Unit tests
npm test

# Integration tests (tenant isolation, audit chain concurrency, rollback)
TEST_DATABASE_URL=postgresql://app_user:...@localhost:5432/payflow \
TEST_DATABASE_OWNER_URL=postgresql://owner:...@localhost:5432/payflow \
npm test
```

- `TEST_DATABASE_URL` is the **app role**, so RLS is exercised.
- `TEST_DATABASE_OWNER_URL` is the table owner, used only to seed and clean up, because immutability triggers block deletes for everyone else.
- `tests/unit/access-guards.test.ts` fails the build if any server action, API route or admin page is added without a permission or session guard.

**Browser tests** (`tests/e2e/phase2..9-smoke.mjs`, `password-reset-smoke.mjs`) drive the real UI with Playwright. They need a seeded database and the app running on port 3100. Sign-in and sign-up are rate limited, so the scripts pause between runs. The Phase 9 run also fails on any Content-Security-Policy violation.

## Security

- **CSP**: nonce-based (`src/lib/csp.ts`, set per request in `src/middleware.ts`) with `strict-dynamic`, no `unsafe-inline` for scripts, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. Additional headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- **Access control**: every server action runs through `runAction` (permission check, transaction, audit entry), backed by RLS. A test enforces that no unguarded entry point is added.
- **Data protection**: AES-256-GCM for sensitive fields, masked display, audited reveals, masked data exports.
- **Rate limiting**: Better Auth limits stored in Postgres so they hold across instances; separate limits for API keys, webhooks, PayBot and password reset.
- **SSRF protection**: outbound calls (webhooks, Slack, Teams) require https, refuse private, loopback, link-local and metadata addresses, and never follow redirects.
- **API keys**: shown once, stored only as SHA-256 hashes, scoped, expiring, instantly revocable. Responses use explicit field allow-lists.
- **Webhooks**: HMAC-SHA256 over `timestamp.body`, 5-minute replay window, encrypted signing secrets.
- **Input handling**: Zod validation everywhere, magic-byte file checks, CSV formula neutralisation.
- **Account safety**: neutral forgot-password responses to prevent account enumeration, single-use expiring reset links, sessions revoked everywhere on reset, SSO-enforced domains cannot use password reset.
- **Dependencies**: `npm audit --omit=dev` reports no critical issues and CI fails on critical. Accepted advisories: `inngest` pulls a `zod` version with a high advisory (parses only our own payloads), `exceljs` pulls an old `uuid` (moderate), and `drizzle-kit`'s `esbuild` is dev-only. `postcss` is pinned via `overrides` and `next` is pinned to 15.5.29. Re-check before every release.
- **Secrets**: a scan found none committed; real `.env*` files are git-ignored.

To report a vulnerability, please open a private security advisory on the repository rather than a public issue.

## Performance

- First-load JS per route: **104-250 kB** (shared 103 kB). The heaviest are the payroll run page (charts and animation) and the workflow builder (React Flow, loaded only there).
- Lighthouse (desktop, production build, local): landing **96-98** performance; login and sign-up **100**; accessibility **100**, SEO **100**, best practices **96-100**. LCP under one second.
- Because every page carries a per-request CSP nonce, pages are rendered on demand rather than statically cached.
- Authenticated pages were not audited by Lighthouse.

## CI/CD and Deployment

`.github/workflows/ci.yml` runs on every push and pull request:

1. Format check, lint (zero warnings), typecheck
2. `npm audit`
3. Migrations and RLS applied to a pgvector Postgres with a non-owner app role
4. Tests with coverage thresholds
5. Production build
6. Seeded browser smoke test (including CSP checks)
7. Lighthouse CI on public pages
8. Docker image build and boot check

**Deploying to Vercel:** set the environment variables above, apply migrations and RLS to your database as the owner role, and use a non-owner role in `DATABASE_URL`. Point a scheduler at `GET /api/cron/tick` (Bearer `CRON_SECRET`) every 5 minutes, or configure Inngest. On serverless hosts, unawaited email sends can be cut short; prefer Node or Docker hosting for reliable delivery, or await the send.

## Public API and Webhooks

Read-only REST API at `/api/v1` for employees, payroll runs, leave requests and attendance. Create keys at `/developers`; the OpenAPI spec is served at `/api/v1/openapi.json`.

```bash
curl https://payflow-five-nu.vercel.app/api/v1/employees \
  -H "Authorization: Bearer pf_live_xxxxxxxxxxxxxxxx"
```

- Amounts are integer paise.
- Bank, PAN, Aadhaar, UAN and ESI numbers are never returned.
- Rate limit exceeded returns `429` with `Retry-After` and `X-RateLimit-*` headers.

Webhook events: `leave.applied`, `payroll.approved`, `employee.joined`, `deadline.near`, `payroll.paid`. Verify the `X-PayFlow-Signature` header using the example on the Developers page. Failed deliveries retry at 1m, 5m, 30m, 2h and 8h, then can be resent manually.

## Project Status

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

## Known Limitations

This project is explicit about what has and has not been verified. **Review this list before any production use.**

**Statutory data to verify before real use**
- PF ceiling change date (Sep 2026), Professional Tax slabs (`src/lib/payroll/pt.ts`), and surcharge and slab rates.
- PT due dates use a generic default (15th of the next month).
- 80D is modelled as Rs 25,000 + Rs 25,000 without senior-citizen limits. Overtime pay is Basic/26/8 x 2.
- The Form 16 download is a **summary**, not the TRACES-signed certificate.

**Not implemented or simulated**
- **SAML SSO is not implemented.** Google and Microsoft sign-in work only when client IDs are set.
- **Earned wage access payouts are a mock.** No money moves.
- Employee e-sign and bank-verification onboarding steps are tasks for a person, not a legal e-signature or verification service.
- Multi-currency is display-only; payroll, payslips and returns are always INR.
- Attrition risk is a rule-based score, not a trained model. No market salary data is bundled.

**Not verified in the build environment**
- Gemini (chat, embeddings, Vision, generators), Inngest, Resend and WhatsApp delivery, and the Razorpay adapter beyond simulation. Test Razorpay in test mode first.
- pgvector semantic-search SQL (keyword search is tested end to end).
- The GitHub Actions run itself and the Docker image build (the standalone server was booted and served `/login` with its CSP and a healthy `/api/health`).
- The PWA on a real phone, browser voice input, and Hindi copy (written without a native reviewer; only the app shell, attendance panel and privacy page are translated).

**Behavioural notes**
- `payroll.paid` webhooks are delivered on the next sweep (minutes), not instantly. The SSE stream polls every 4 seconds per open tab.
- Rate limiting for PayBot is per-process unless Upstash is configured.
- Scanned PDFs have no text layer and are refused for policy upload.
- Generated letters are drafts, not legal advice.
- The Phase 5 notification-bell E2E step failed intermittently (2 of 4 runs) with a likely race between the live-notification refresh and the read refresh; the underlying action works in isolation and the race has not been fixed.

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes with tests. New server actions, API routes and admin pages must carry a permission or session guard (the access-guard test will fail otherwise).
3. Run `npm run verify` and make sure it passes.
4. Open a pull request describing the change and any statutory or security implications.

## License

Add your license here (for example MIT) and include a `LICENSE` file in the repository root.

## Author

**Suraj Purai**

Built as a full-stack, multi-phase project covering payroll compliance, multi-tenant security, AI and automation.

---

<div align="center">
<sub>PayFlow is a software project and does not constitute tax, legal or financial advice. Verify statutory rules with a qualified professional before running real payroll.</sub>
</div>
