<div align="center">

# ⚡ PayFlow

### AI-powered, automation-first payroll and HR for Indian companies

*Run compliant payroll, let an AI copilot prepare the work, and keep a human in charge of every decision that matters.*

<br/>

[**🚀 Live Demo**](https://payflow-five-nu.vercel.app/) &nbsp;·&nbsp; [**🏗 Architecture**](#-architecture) &nbsp;·&nbsp; [**🔁 Workflows**](#-workflows-and-lifecycles) &nbsp;·&nbsp; [**🛠 Setup**](#-getting-started) &nbsp;·&nbsp; [**🔐 Security**](#-security-model) &nbsp;·&nbsp; [**⚠️ Limitations**](#%EF%B8%8F-known-limitations)

<br/>

![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20+%20pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Gemini-8E75B2?style=flat-square&logo=googlegemini&logoColor=white)
![Tests](https://img.shields.io/badge/tests-512%20passing-2ea44f?style=flat-square)
![Coverage](https://img.shields.io/badge/coverage-81%25-2ea44f?style=flat-square)
![Lighthouse](https://img.shields.io/badge/Lighthouse-96–100-2ea44f?style=flat-square)

</div>

---

## 📖 Table of Contents

1. [Overview](#-overview)
2. [At a Glance](#-at-a-glance)
3. [Product Map](#-product-map)
4. [Architecture](#-architecture)
5. [Workflows and Lifecycles](#-workflows-and-lifecycles)
6. [AI Layer](#-ai-layer)
7. [Automation Engine](#-automation-engine)
8. [Data and Tenancy](#-data-and-tenancy)
9. [Security Model](#-security-model)
10. [Quality and Performance](#-quality-and-performance)
11. [Tech Stack](#-tech-stack)
12. [Getting Started](#-getting-started)
13. [Configuration](#-configuration)
14. [Scripts](#-scripts)
15. [Testing](#-testing)
16. [CI/CD and Deployment](#-cicd-and-deployment)
17. [Public API and Webhooks](#-public-api-and-webhooks)
18. [Roadmap and Status](#-roadmap-and-status)
19. [Known Limitations](#%EF%B8%8F-known-limitations)
20. [Contributing](#-contributing)
21. [Author](#-author)

---

## 🧭 Overview

PayFlow runs the full monthly payroll cycle for Indian companies: organisation setup, employee records, salary structures, attendance and leave, statutory deductions (PF, ESI, Professional Tax, TDS), payslips, payments and compliance tracking. An AI layer and an automation layer remove repetitive work, while every consequential action still requires a human.

### Design principles

| Principle | What it means in practice |
| --- | --- |
| 💰 **Integer paise, always** | No floating point in any payroll path. All money is integer paise (`src/lib/money.ts`). |
| 🧱 **Two-layer tenant isolation** | Application membership checks plus Postgres row-level security. A bug in one layer is caught by the other. |
| 🤝 **Humans approve, machines prepare** | Maker-checker on payroll. The AI can only *propose* actions; it has no write path. |
| 🧾 **Tamper-evident history** | Append-only, hash-chained audit log written in the same transaction as every change. |
| 🪞 **Honest by design** | Anything simulated, unverified or unimplemented is labelled in the UI and listed in this document. |

### What makes it different

- **The AI cannot act on its own.** It proposes; a stored, expiring, atomically-claimed proposal runs only after a person confirms.
- **Automation never reacts to a rolled-back change.** Events are recorded in the same transaction as the business change.
- **Anonymous surveys are anonymous by structure**, not by policy: who answered and what was answered live in separate tables.
- **Degrades gracefully.** No AI key? A deterministic engine takes over. No email key? Steps are recorded as skipped, never faked.

---

## 📊 At a Glance

| 🧪 Tests | 📈 Coverage | ⚡ Lighthouse | 📦 First-load JS | 🧩 Phases |
| :---: | :---: | :---: | :---: | :---: |
| **512** in 43 files | **81%** statements | **96–100** performance | **104–250 kB** per route | **10 / 10** done |

```mermaid
xychart-beta
    title "Test coverage vs enforced CI floor (%)"
    x-axis ["Statements", "Lines", "Functions", "Branches"]
    y-axis "Percent" 0 --> 100
    bar [81, 83, 79, 68]
    line [80, 80, 75, 60]
```

> The line is the floor enforced in `vitest.config.ts`. CI fails if any metric drops below it.

```mermaid
xychart-beta
    title "Lighthouse scores (desktop, production build, local)"
    x-axis ["Landing", "Login", "Sign-up"]
    y-axis "Score" 90 --> 100
    bar [97, 100, 100]
```

*Landing performance measured 96–98 across runs; the bar shows the midpoint. Accessibility and SEO scored 100 on all three pages. Authenticated pages were not audited by Lighthouse.*

---

## 🗺 Product Map

```mermaid
mindmap
  root((PayFlow))
    Foundation
      Auth and 2FA
      RBAC five roles
      Multi-tenancy
      Hash-chained audit
    People
      Setup wizard
      Employees
      Documents
      Salary structures
      Onboarding
    Payroll
      PF ESI PT TDS
      Maker-checker lifecycle
      Payslips
      RazorpayX
      Full and final
    Time and Money
      Attendance
      Leave
      Expenses
      Tax declarations
      Compliance calendar
    Intelligence
      PayBot
      Payroll Copilot
      Agentic actions
      Policy RAG
      Document AI
      Analytics
    Automation
      Visual workflows
      Payroll pipeline
      Public API
      Webhooks
      Live notifications
    Employee Experience
      Salary simulator
      Earned wage access
      Recognition
      Anonymous surveys
      PWA offline
      Hindi
```

### Role access

| Capability | Super Admin | HR Admin | Finance | Manager | Employee |
| --- | :---: | :---: | :---: | :---: | :---: |
| Company dashboard | ✅ | ✅ | ✅ | – | – |
| Team dashboard | ✅ | ✅ | – | ✅ | – |
| Personal dashboard and payslips | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage employees and policies | ✅ | ✅ | – | – | – |
| Prepare and approve payroll | ✅ | ✅ | ✅ | – | – |
| Decide leave | ✅ | ✅ | – | direct reports | – |
| Agentic AI actions (`ai:act`) | ✅ | ✅ | ✅ | limited | ❌ |
| Workflows, API keys, enterprise settings | ✅ | per permission | – | – | – |

*Illustrative summary. The authoritative source is the permission map in the codebase, enforced server-side.*

---

## 🏗 Architecture

### System context

```mermaid
flowchart LR
    subgraph Client["🖥 Client"]
        B["Browser PWA<br/>offline attendance queue"]
        V["Voice input<br/>Web Speech API"]
    end

    subgraph Edge["🛡 Edge"]
        M["Middleware<br/>session cookie check<br/>nonce-based CSP"]
    end

    subgraph App["⚙️ Next.js 15 application"]
        RSC["Server Components"]
        SA["Server Actions<br/>runAction"]
        API["Public API /api/v1"]
        SSE["SSE notifications"]
        JOBS["Job engine<br/>plain functions"]
    end

    subgraph Data["🗄 Data"]
        PG[("PostgreSQL 16<br/>RLS + triggers<br/>pgvector")]
        RL[("Upstash Redis<br/>rate limits")]
    end

    subgraph Ext["🌐 External services"]
        GEM["Google Gemini<br/>chat / embeddings / vision"]
        RZP["RazorpayX"]
        RES["Resend email"]
        ING["Inngest"]
        SLK["Slack / Teams / WhatsApp"]
        WH["Customer webhooks"]
    end

    B --> M --> RSC
    B --> M --> SA
    V --> B
    Ext2["API consumers"] --> API
    RSC --> PG
    SA --> PG
    API --> PG
    SSE --> PG
    JOBS --> PG
    SA --> RL
    API --> RL
    SA --> GEM
    SA --> RZP
    JOBS --> RES
    JOBS --> SLK
    JOBS --> WH
    ING --> JOBS
    RZP -. "signed webhook" .-> API
```

### Request lifecycle

Every mutation follows the same guarded path, so permissions, tenancy and audit cannot be forgotten by an individual feature.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant MW as Middleware
    participant SA as Server Action
    participant CTX as getContext
    participant DB as Postgres (RLS)
    participant AU as Audit chain

    U->>MW: Request with session cookie
    MW->>MW: Cookie check + per-request CSP nonce
    MW->>SA: Forward
    SA->>CTX: Validate session, membership, role
    CTX-->>SA: Context (user, org, role)
    SA->>SA: requireActionPermission(perm)
    SA->>SA: Zod-validate input
    SA->>DB: BEGIN; withTenant(orgId)
    Note over DB: SET app.current_org = orgId<br/>RLS policies now filter every query
    SA->>DB: Domain change
    SA->>AU: writeAudit(tx) hash-chained
    DB-->>SA: COMMIT (change and audit succeed or fail together)
    SA-->>U: Result
```

### Guardrails by layer

```
┌──────────────────────────────────────────────────────────────────────┐
│  EDGE         cookie check · nonce CSP · security headers · HSTS     │
├──────────────────────────────────────────────────────────────────────┤
│  CONTEXT      session → membership → role   (re-validated per call)  │
├──────────────────────────────────────────────────────────────────────┤
│  ACTION       requireActionPermission · Zod · rate limit · runAction │
├──────────────────────────────────────────────────────────────────────┤
│  DOMAIN       maker-checker · locks · one-live-run-per-month         │
├──────────────────────────────────────────────────────────────────────┤
│  DATABASE     RLS by app.current_org · CHECKs · immutability triggers│
├──────────────────────────────────────────────────────────────────────┤
│  AUDIT        append-only · hash-chained · same transaction          │
└──────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
payflow/
├── src/
│   ├── app/                 # App Router: pages, layouts, API routes
│   ├── lib/
│   │   ├── money.ts         # integer-paise helpers
│   │   ├── csp.ts           # nonce-based CSP
│   │   ├── payroll/         # engine: PF, ESI, PT (pt.ts), TDS, LOP, F&F
│   │   └── ai/              # tools.ts, guardrails, fallback engine
│   ├── inngest/             # Inngest wrappers around the job engine
│   └── middleware.ts        # session check + CSP nonce
├── drizzle/                 # migrations and rls.sql
├── docker/                  # postgres-init.sql (creates payflow_app role)
├── public/                  # sw.js, offline.html, icons
├── tests/
│   ├── unit/                # includes access-guards.test.ts
│   └── e2e/                 # phase2..9 and password-reset smoke scripts
├── .github/workflows/ci.yml
├── docker-compose.yml
└── vitest.config.ts
```

---

## 🔁 Workflows and Lifecycles

### Payroll run lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft: Create run
    Draft --> Review: Submit
    Review --> Draft: Changes requested
    Review --> Approved: Approver confirms
    Approved --> Processing: Start payment
    Processing --> Paid: Provider settles
    Draft --> Cancelled: Cancel
    Review --> Cancelled: Cancel
    Paid --> [*]
    Cancelled --> [*]

    note right of Review
        Maker-checker
        Approver must differ from preparer
        and submitter. DB CHECK + server check.
    end note
    note right of Approved
        Items locked by trigger
        once the run leaves draft
    end note
```

| Stage | Guarantee |
| --- | --- |
| Draft | Only one live run per month (partial unique index). |
| Review | Pre-approval checklist and anomaly detection surface problems with fix links. |
| Approved | Approver ≠ preparer ≠ submitter, enforced in the database and on the server. |
| Processing | Run row locked; payment is always started by a person. |
| Paid | Approved expense claims marked paid; `payroll.paid` webhook queued. |

### End-to-end monthly cycle

```mermaid
flowchart TD
    A["📅 Month ends"] --> B["Lock attendance<br/>absent marked, trigger freezes month"]
    B --> C["Create payroll draft<br/>LOP and overtime from locked attendance"]
    C --> D["Statutory engine<br/>PF · ESI · PT · TDS · loans · arrears"]
    D --> E["Pre-run checklist<br/>+ anomaly detection"]
    E -->|"high-severity anomaly<br/>or failing check"| X["⛔ Pipeline stops<br/>and explains why"]
    E -->|"clean"| F["Submit for approval"]
    F --> G["👤 Human approver<br/>must differ from preparer"]
    G --> H["Process and pay<br/>started by a person"]
    H --> I["Payslips published<br/>employees notified"]
    H --> J["Compliance calendar<br/>challans and CSV reports"]
    X --> C
```

### Attendance and leave decisions

```mermaid
flowchart LR
    L["Leave request"] --> C1{"Overlap and balance<br/>checks pass?"}
    C1 -- no --> R1["Rejected at submit"]
    C1 -- yes --> C2{"Who decides?"}
    C2 -->|"HR"| D["Any request"]
    C2 -->|"Manager"| E["Direct reports only"]
    C2 -->|"Requester"| F["❌ Never their own"]
    D --> G["Approved"]
    E --> G
    G --> H{"Unpaid?"}
    H -- yes --> I["Counts as LOP in payroll"]
    H -- no --> J["Balance reduced"]
```

---

## 🤖 AI Layer

### Agentic Copilot: propose, confirm, execute

The model has no write path. It can only create a *proposal*, which a person must confirm.

```mermaid
sequenceDiagram
    autonumber
    actor P as Person
    participant PB as PayBot (LLM)
    participant TL as Propose tools
    participant AA as ai_actions table
    participant UI as Confirm card
    participant DM as Domain code
    participant AU as Audit chain

    P->>PB: "Approve Priya's leave"
    PB->>TL: propose_approve_leave
    TL->>TL: Check ai:act + underlying permission
    TL->>AA: Store parameters server-side (15 min expiry)
    TL-->>UI: Card listing exactly what will change
    P->>UI: Confirm (typed CONFIRM if destructive)
    UI->>AA: Claim row atomically
    Note over AA: Double click or second tab<br/>cannot claim twice
    AA->>DM: Run STORED parameters (client cannot alter)
    DM->>DM: Permission, validation, same code as normal screens
    DM->>AU: leave.approved
    AU->>AU: ai.action.executed
    DM-->>P: Result
```

| Proposal tool | Destructive (needs typed `CONFIRM`) |
| --- | :---: |
| `propose_approve_leave` | – |
| `propose_reject_leave` | – |
| `propose_create_payroll_draft` | – |
| `propose_department_raise` | ✅ |
| `propose_cancel_payroll_run` | ✅ |

A department raise re-checks that each salary is unchanged since the preview, then applies all-or-nothing as append-only revisions.

### PayBot request path

```mermaid
flowchart TD
    Q["User message"] --> G1["Guardrails<br/>injection and jailbreak refusal"]
    G1 --> G2["PII masking<br/>PAN · Aadhaar · IFSC · email · phone · account"]
    G2 --> RL{"Rate limit 20 msg/min<br/>and daily token budget?"}
    RL -- over --> Z["Polite refusal"]
    RL -- ok --> MODE{"Gemini key set<br/>and service healthy?"}
    MODE -- yes --> LLM["Gemini with tools"]
    MODE -- no --> FB["Deterministic keyword engine"]
    LLM --> T["11 read-only tools<br/>permission re-checked at call time<br/>Zod in and out"]
    FB --> T
    T --> S["Tool-output sanitising"]
    S --> R["Streamed reply<br/>sources · charts · follow-ups"]
    R --> LOG["ai_usage<br/>tokens and estimated cost"]
```

### AI feature summary

| Feature | Behaviour | Safety net |
| --- | --- | --- |
| **PayBot** | Streaming, role-aware, voice (English/Hindi), read-aloud | 11 read-only tools; no tool takes an employee id or a query |
| **Payroll Copilot** | Checklist plus anomaly detection (spikes, duplicate bank accounts, abnormal deductions, ghost employees) | Deterministic explanations; "expected" flag is audited |
| **Payslip explainer** | English or Hindi, own payslip only | Every rupee figure must exist on the payslip or the answer is discarded |
| **Policy RAG** | PDF/TXT/MD, ~900-char chunks, Gemini 768-d embeddings, pgvector HNSW | Cosine search, else Postgres full-text with relevance filter; cites document and page |
| **Document AI** | Vision extraction from PAN, Aadhaar, bank proof, resume | Person must verify; PAN format, Aadhaar Verhoeff checksum, IFSC checks; file not stored |
| **Generators** | Offer and appointment letters, JDs, announcement emails | Drafts only; facts verified against inputs |

---

## 🔄 Automation Engine

### Visual workflows

```mermaid
flowchart LR
    T["⚡ Trigger<br/>leave.applied<br/>payroll.approved<br/>employee.joined<br/>deadline.near"] --> C{"Condition<br/>yes / no"}
    C -- yes --> A1["📧 Email"]
    C -- yes --> A2["💬 Slack / Teams"]
    C -- no --> A3["🔔 In-app notification"]
    A1 --> AP["✋ Approval step<br/>pauses the run"]
    AP -- approved --> A4["🔗 Webhook"]
    AP -- rejected --> A5["📝 Task"]
```

**Reliability model**

```mermaid
flowchart TD
    E["Business change commits"] --> EV["Event row written<br/>in the SAME transaction"]
    EV --> DD{"Dedupe key seen?"}
    DD -- yes --> SKIP["Ignore (idempotent)"]
    DD -- no --> RUN["Create workflow run"]
    RUN --> STEP["Execute step"]
    STEP -->|"success"| NEXT["Record step, continue"]
    STEP -->|"failure"| RT{"Attempts left?"}
    RT -- yes --> BO["Backoff and retry<br/>finished steps never repeat"]
    BO --> STEP
    RT -- no --> FAIL["Run failed<br/>admins notified, manual retry"]
    NEXT --> DONE["Run complete with step-by-step log"]
```

### How background work is driven

```mermaid
flowchart LR
    subgraph Preferred
        I["Inngest<br/>INNGEST_EVENT_KEY set"] --> FN["Job functions<br/>src/inngest"]
    end
    subgraph Fallback
        CR["Any scheduler every 5 min<br/>GET /api/cron/tick<br/>Bearer CRON_SECRET"] --> SW["Sweep stranded runs<br/>and due webhook retries"]
        RA["Run right after response"] --> SW
    end
    FN --> ENG["Plain-function engine"]
    SW --> ENG
    ENG --> DB[("Database rows<br/>are the source of truth")]
```

A crash cannot lose work, because state lives in database rows rather than in a queue.

### Webhook delivery

| Attempt | Delay |
| :---: | :---: |
| 1 | immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 | 8 hours |
| After | marked **failed**, manual **Resend** button |

---

## 🗄 Data and Tenancy

### Tenant isolation

```mermaid
flowchart TD
    REQ["Request"] --> CK["Active-company cookie"]
    CK --> VAL{"Re-validated against<br/>memberships every request?"}
    VAL -- no --> DENY["Rejected"]
    VAL -- yes --> WT["withTenant orgId, fn"]
    WT --> SET["SET app.current_org = orgId<br/>per transaction"]
    SET --> POL["RLS policy:<br/>organization_id = current_setting app.current_org"]
    POL --> ROWS["Only this tenant's rows visible"]
```

> ⚠️ Postgres does **not** apply RLS to table owners or superusers. Migrate as the owner, but run the app as a **non-owner** role (`payflow_app`).

### Simplified entity model

```mermaid
erDiagram
    ORGANIZATION ||--o{ MEMBERSHIP : has
    USER ||--o{ MEMBERSHIP : holds
    ORGANIZATION ||--o{ EMPLOYEE : employs
    EMPLOYEE ||--o{ SALARY_REVISION : "append-only"
    EMPLOYEE ||--o{ ATTENDANCE : records
    EMPLOYEE ||--o{ LEAVE_REQUEST : files
    EMPLOYEE ||--o{ EXPENSE_CLAIM : submits
    ORGANIZATION ||--o{ PAYROLL_RUN : runs
    PAYROLL_RUN ||--o{ PAYROLL_ITEM : contains
    EMPLOYEE ||--o{ PAYROLL_ITEM : paid_in
    ORGANIZATION ||--o{ AUDIT_ENTRY : "hash-chained"
    ORGANIZATION ||--o{ AI_ACTION : "proposals"
    ORGANIZATION ||--o{ WORKFLOW : defines
    WORKFLOW ||--o{ WORKFLOW_RUN : executes
    ORGANIZATION ||--o{ API_KEY : issues
    ORGANIZATION ||--o{ WEBHOOK_ENDPOINT : subscribes
```

*Conceptual view for orientation; table and column names in the schema may differ.*

### Audit chain

```mermaid
flowchart LR
    E1["Entry N-1<br/>hash h(N-1)"] --> E2["Entry N<br/>prev = h(N-1)<br/>hash = H(payload + prev)"] --> E3["Entry N+1<br/>prev = h(N)"]
```

Database triggers block `UPDATE` and `DELETE` on the audit table, even for its owner. The `/audit` page verifies the chain.

---

## 🔐 Security Model

| Area | Controls |
| --- | --- |
| **Transport and browser** | Nonce-based CSP with `strict-dynamic`, no `unsafe-inline` scripts, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`. |
| **Authentication** | Better Auth, Google/Microsoft SSO, TOTP 2FA with backup codes, SSO-domain enforcement, single-use 60-minute reset links, sessions revoked everywhere on reset. Session checks skip the cookie cache so revocation is immediate. |
| **Authorisation** | RBAC in middleware, `getContext()` and every action via `runAction`; RLS as second layer. `access-guards.test.ts` fails the build on any unguarded action, API route or admin page. |
| **Data at rest** | AES-256-GCM for PAN, Aadhaar and bank details; masked in UI and exports; reveals audited. |
| **Uploads** | PDF/PNG/JPG ≤ 5 MB validated by magic bytes; permission-checked, audited downloads. |
| **CSV** | All-or-nothing import; exports omit sensitive fields and neutralise formulas. |
| **Outbound calls** | https only; refuse private, loopback, link-local and metadata ranges; never follow redirects (SSRF guard). |
| **API keys** | `pf_live_…` shown once, stored as SHA-256 hash; scoped, rate-limited, expiring, instantly revocable; explicit field allow-lists. |
| **Webhooks** | HMAC-SHA256 over `timestamp.body`, 5-minute replay window, encrypted signing secret. |
| **Rate limits** | Postgres-backed auth limits (shared across instances); separate limits for API keys, webhooks, PayBot, password reset. |
| **Privacy** | Personal-data export (identifiers masked to last 4); erasure workflow gated on exit and HR review; statutory records retained. |
| **Supply chain** | CI fails on critical `npm audit` findings; `postcss` pinned via overrides; `next` pinned to 15.5.29; no secrets committed. |

**Accepted advisories (re-check each release):** `inngest` pulls a `zod` version with a high advisory (parses only our own payloads); `exceljs` pulls an old `uuid` (moderate); `drizzle-kit`'s `esbuild` is dev-only.

To report a vulnerability, please use a **private security advisory** on the repository rather than a public issue.

---

## 🧪 Quality and Performance

### Quality gates

```mermaid
flowchart LR
    P["Push / PR"] --> F["Format · Lint (0 warnings) · Typecheck"]
    F --> AU["npm audit<br/>fail on critical"]
    AU --> DB["Migrate + RLS on pgvector Postgres<br/>non-owner role"]
    DB --> TS["Tests + coverage floors"]
    TS --> BD["Production build"]
    BD --> E2["Seeded browser smoke<br/>including CSP violations"]
    E2 --> LH["Lighthouse CI<br/>public pages"]
    LH --> DK["Docker build + boot check"]
```

### Bundle budget

```mermaid
xychart-beta
    title "First-load JS (kB), range across routes"
    x-axis ["Lightest route", "Shared baseline", "Workflow builder", "Payroll run page"]
    y-axis "kB" 0 --> 260
    bar [104, 103, 218, 250]
```

The workflow builder's React Flow is loaded only on that route. Charts are inline SVG with no chart library, each with a screen-reader text equivalent. LCP is under one second on public pages.

---

## 🧰 Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router, Server Actions), React, TypeScript strict |
| Styling | Tailwind CSS v4, Geist, dark/light theme |
| Database | PostgreSQL 16, pgvector, Drizzle ORM, row-level security |
| Auth | Better Auth (email/password, Google, Microsoft, TOTP) |
| Validation | Zod |
| AI | Google Gemini (chat, `gemini-embedding-001`, Vision) with deterministic fallback |
| Jobs | Inngest, with cron-tick fallback |
| Payments | RazorpayX (simulated by default) |
| Email | Resend |
| Rate limiting | Upstash Redis (in-memory fallback), Postgres for auth |
| Workflows | React Flow |
| i18n | next-intl (English, Hindi) |
| Testing | Vitest, Playwright, Lighthouse CI |
| Delivery | GitHub Actions, Docker (multi-stage, non-root), Vercel |

---

## 🛠 Getting Started

### Prerequisites

- Node.js 20+ and npm
- PostgreSQL 16 (pgvector recommended) or Docker

### Install

```bash
git clone <your-repository-url>
cd payflow

cp .env.example .env          # fill in DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY
npm install

npm run db:generate           # only after schema changes
npm run db:migrate            # apply migrations (as the OWNER role)
npm run db:rls                # apply row-level security + audit triggers
npm run dev
```

Generate secrets:

```bash
openssl rand -base64 32       # BETTER_AUTH_SECRET
openssl rand -hex 32          # ENCRYPTION_KEY
```

### Database roles (important)

Run migrations as the table owner, but point the app's `DATABASE_URL` at a **non-owner role**, otherwise RLS is silently bypassed.

```bash
docker compose up db          # Postgres 16 + pgvector; creates the payflow_app role
```

On Neon or another managed provider, create a separate application role and grant it table privileges.

### Seed demo data

```bash
npm run db:seed               # deterministic; refuses to run twice
npm run db:seed -- --reset    # rebuild
```

Creates **Brightwave Technologies**: 50 employees across 6 departments, about 6,000 attendance records, leave, expenses, 6 months of paid payroll produced by the real engine, sample policies, recognition, an open survey, EWA enabled and salary benchmarks.

| Role | Email |
| --- | --- |
| Super Admin | `admin@payflow.demo` |
| HR Admin | `hr@payflow.demo` |
| Finance | `finance@payflow.demo` |
| Manager | `manager@payflow.demo` |
| Employee | `employee@payflow.demo` |

Password: `PayFlowDemo#2026`

> ⚠️ These credentials are public. Change or delete them before using the database for anything real.

### Docker

```bash
docker compose up
```

Starts Postgres 16 with pgvector and the app image (multi-stage, standalone output, non-root, health check at `/api/health`). Run migrations and `npm run db:rls` as the owner first, and provide real secrets in `.env`.

---

## ⚙️ Configuration

See `.env.example` for the full list.

| Variable | Required | Purpose |
| --- | :---: | --- |
| `DATABASE_URL` | ✅ | App connection (non-owner role) |
| `BETTER_AUTH_SECRET` | ✅ | Auth signing secret |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex key for AES-256-GCM |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | – | Enables Gemini features |
| `AI_DAILY_TOKEN_LIMIT` | – | Daily AI token budget |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | – | RazorpayX payments |
| `RAZORPAYX_ACCOUNT_NUMBER` | – | RazorpayX account |
| `RAZORPAY_WEBHOOK_SECRET` | – | Verifies `/api/webhooks/razorpay` |
| `INNGEST_EVENT_KEY` | – | Enables Inngest |
| `CRON_SECRET` | – | Protects `/api/cron/tick` |
| `RESEND_API_KEY`, `RESEND_FROM` | – | Transactional email and password reset |
| `ALLOW_PRIVATE_WEBHOOKS` | – | `1` for local E2E only; disables SSRF guard |

Google/Microsoft client IDs and Upstash credentials are also read from the environment; see `.env.example` for exact names.

### Graceful degradation

| Missing | Behaviour |
| --- | --- |
| `GEMINI_API_KEY` | PayBot uses keyword engine; Document AI is manual entry with the same verification; policy search is keyword-only; generators fill standard templates |
| Resend / WhatsApp keys | Steps recorded as *skipped (not configured)*, never faked |
| Inngest | Work runs after the response; `/api/cron/tick` sweeps |
| Upstash | In-memory rate limits (per process) |
| Razorpay keys | Simulated payment provider |
| pgvector | Full-text policy search |

---

## 📜 Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run verify` | Typecheck, lint, tests and build |
| `npm test` | Unit tests (DB tests skip without URLs) |
| `npm run test:coverage` | Coverage with enforced floors |
| `npm run db:generate` / `db:migrate` / `db:rls` | Schema workflow |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Demo company |
| `npm run e2e:smoke` | Browser smoke test (port 3100, non-owner role) |

---

## ✅ Testing

```
512 tests · 43 files
├── unit tests
├── integration tests     real Postgres, non-owner role, RLS exercised
└── seeded-company invariants
```

```bash
npm test

# Integration tests
TEST_DATABASE_URL=postgresql://app_user:...@localhost:5432/payflow \
TEST_DATABASE_OWNER_URL=postgresql://owner:...@localhost:5432/payflow \
npm test
```

- `TEST_DATABASE_URL` is the **app role** so RLS is exercised.
- `TEST_DATABASE_OWNER_URL` seeds and cleans up only, because immutability triggers block deletes for everyone else.
- Browser tests (`tests/e2e/phase2..9-smoke.mjs`, `password-reset-smoke.mjs`) need Playwright, a seeded database and the app on port 3100. Auth is rate limited, so scripts pause between runs. The Phase 9 run fails on any CSP violation. `password-reset-smoke.mjs` needs `E2E_DATABASE_URL` (owner connection).

---

## 🚢 CI/CD and Deployment

**CI** (`.github/workflows/ci.yml`) runs the gate pipeline shown in [Quality Gates](#quality-gates) on every push and pull request.

**Vercel**

1. Set the environment variables above.
2. Apply migrations and RLS as the owner; use a non-owner role in `DATABASE_URL`.
3. Schedule `GET /api/cron/tick` (Bearer `CRON_SECRET`) every 5 minutes, or configure Inngest.
4. On serverless hosts an unawaited email send can be cut short. Prefer Node or Docker hosting for reliable delivery, or await the send.

Pages render on demand (not statically cached) because every response carries a per-request CSP nonce.

---

## 🔌 Public API and Webhooks

Read-only REST API at `/api/v1`: employees, payroll runs, leave requests, attendance. Create keys at `/developers`; spec at `/api/v1/openapi.json`.

```bash
curl https://payflow-five-nu.vercel.app/api/v1/employees \
  -H "Authorization: Bearer pf_live_xxxxxxxxxxxxxxxx"
```

- Amounts are integer paise.
- Bank, PAN, Aadhaar, UAN and ESI numbers are never returned.
- Over limit returns `429` with `Retry-After` and `X-RateLimit-*` headers.

**Webhook events:** `leave.applied`, `payroll.approved`, `employee.joined`, `deadline.near`, `payroll.paid`.

Verify the `X-PayFlow-Signature` header (HMAC-SHA256 over `timestamp.body`, 5-minute window); an example verifier is on the Developers page.

---

## 🗓 Roadmap and Status

All ten planned phases are complete.

```mermaid
gantt
    title Delivery phases
    dateFormat  X
    axisFormat  Phase %s
    section Core
    1 Foundation, auth, RBAC, tenancy      :done, 0, 1
    2 Org, employees, salary structures    :done, 1, 2
    3 Payroll engine and payments          :done, 2, 3
    4 Attendance, leave, tax, reports      :done, 3, 4
    5 Dashboards and landing page          :done, 4, 5
    section Intelligence and scale
    6 PayBot, Copilot, explainers          :done, 5, 6
    7 Agentic actions, RAG, Document AI    :done, 6, 7
    8 Automation, API, webhooks            :done, 7, 8
    9 Simulator, EWA, analytics, PWA       :done, 8, 9
    10 Hardening, CI/CD, docs              :done, 9, 10
```

### Candidate next steps

- Real SAML via a verified identity provider
- TRACES-signed Form 16 and per-state PT due dates
- Trained attrition model replacing the rule-based score
- Live bank-verification and e-sign integrations
- Native-reviewed Hindi across all screens
- Postgres LISTEN/NOTIFY for instant notifications

---

## ⚠️ Known Limitations

This project states plainly what is and is not verified. **Review before any production use.**

**Statutory data to verify before real use**
- PF ceiling change date (Sep 2026), Professional Tax slabs (`src/lib/payroll/pt.ts`), surcharge and slab rates.
- PT due dates use a generic default (15th of next month).
- 80D modelled as Rs 25,000 + Rs 25,000 without senior-citizen limits. Overtime pay is Basic/26/8 × 2.
- The Form 16 download is a **summary**, not the TRACES-signed certificate.

**Not implemented or simulated**
- **SAML is not implemented.** Google/Microsoft sign-in works only when client IDs are set.
- **Earned wage access payouts are a mock.** No money moves.
- E-sign and bank-verification onboarding steps are tasks for a person, not legal services.
- Multi-currency is display-only; payroll, payslips and returns are always INR.
- Attrition risk is a transparent rule-based score, not a trained model. No market salary data is bundled.
- Sentiment labels in surveys use a simple word-list scorer.

**Not verified in the build environment**
- Gemini (chat, embeddings, Vision, generators), Inngest, Resend, WhatsApp, and the Razorpay adapter beyond simulation (test in Razorpay test mode first).
- pgvector semantic-search SQL (keyword search is tested end to end).
- The GitHub Actions run itself and the Docker image build (the standalone server was booted and served `/login` with its CSP and a healthy `/api/health`).
- The PWA on a real phone, browser voice input, and Hindi copy (only the app shell, attendance panel and privacy page are translated, without a native reviewer).

**Behavioural notes**
- `payroll.paid` webhooks are delivered on the next sweep (minutes). The SSE stream polls every 4 seconds per open tab.
- PayBot rate limiting is per process unless Upstash is configured.
- Scanned PDFs have no text layer and are refused for policy upload.
- Generated letters are drafts, not legal advice.
- A Phase 5 notification-bell E2E step failed intermittently (2 of 4 runs), likely a race between live-notification refresh and the read refresh. The action works in isolation; the race is unfixed.

---

## 🤝 Contributing

1. Fork and create a feature branch.
2. Add tests. New server actions, API routes and admin pages **must** carry a permission or session guard, or `access-guards.test.ts` fails.
3. Run `npm run verify`.
4. Open a pull request describing the change and any statutory or security implications.

## 📄 License

Add your license (for example MIT) and a `LICENSE` file in the repository root.

## 👤 Author

**Suraj Singh Rajput**

---

<div align="center">
<sub>PayFlow is software, not tax, legal or financial advice. Verify statutory rules with a qualified professional before running real payroll.</sub>
</div>
