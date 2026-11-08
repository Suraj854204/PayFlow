import Link from "next/link";
import {
  Check,
  Calculator,
  CalendarCheck,
  FileText,
  Fingerprint,
  Landmark,
  Receipt,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES: {
  icon: typeof Calculator;
  title: string;
  body: string;
  span?: string;
  soon?: boolean;
}[] = [
  {
    icon: Calculator,
    title: "An India payroll engine you can audit",
    body: "PF with the wage ceiling, ESI, state-wise Professional Tax, TDS under both regimes, LOP, overtime, arrears, loans, gratuity and full-and-final settlement. All money is integer paise, so totals never drift.",
    span: "lg:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Four-eyes approval",
    body: "The person who prepares a run cannot approve it. The database enforces it, not just the interface.",
  },
  {
    icon: FileText,
    title: "Payslips and bank files",
    body: "Branded PDF payslips, a bank upload CSV, and Razorpay test-mode payouts with webhook status tracking.",
  },
  {
    icon: CalendarCheck,
    title: "Attendance that feeds payroll",
    body: "Geo-fenced check-in, shifts, leave with balances and approvals. Lock the month and loss of pay flows into the run.",
  },
  {
    icon: Receipt,
    title: "Expenses to reimbursement",
    body: "Claims with receipts, manager or finance approval, then paid through the next payroll run.",
  },
  {
    icon: Landmark,
    title: "Compliance calendar",
    body: "PF, ESI, PT and TDS due dates, reports to download, challan tracking, and reminders when something is due.",
    span: "lg:col-span-2",
  },
  {
    icon: Fingerprint,
    title: "A tamper-evident audit trail",
    body: "Every change is hash-chained with old and new values. If someone edits history, verification fails.",
  },
  {
    icon: Users,
    title: "Roles and multi-company",
    body: "Super Admin, HR, Finance, Manager and Employee. Each company's data is isolated by row-level security.",
  },
  {
    icon: BarChart3,
    title: "Reports and exports",
    body: "Cost trends, department cost, headcount, attrition, overtime and year-over-year, exported to Excel or PDF.",
  },
  {
    icon: Sparkles,
    title: "AI copilot",
    body: "PayBot, an agent that acts with your confirmation, and policy search are on the roadmap.",
    soon: true,
  },
];

export function Bento() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Everything payroll touches, in one place
        </h2>
        <p className="text-muted-foreground mt-3">
          From the first salary structure to the last challan.
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            style={{ animationDelay: `${i * 40}ms` }}
            className={cn(
              "animate-fade-up group bg-card hover:border-primary/40 relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg",
              f.span,
            )}
          >
            <span className="bg-accent text-accent-foreground grid size-10 place-items-center rounded-xl">
              <f.icon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-4 flex items-center gap-2 font-semibold">
              {f.title}
              {f.soon && (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Coming soon
                </span>
              )}
            </h3>
            <p className="text-muted-foreground mt-1.5 text-sm">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const AUDIENCES = [
  {
    icon: Users,
    who: "HR teams",
    points: [
      "Onboard people with checklists and documents",
      "Decide leave and verify tax declarations in one queue",
      "Lock attendance once and be done",
    ],
  },
  {
    icon: Wallet,
    who: "Finance",
    points: [
      "Review a run line by line before approving",
      "Pull PF, ESI, PT and TDS reports for filing",
      "Export the bank file and watch payments settle",
    ],
  },
  {
    icon: Sparkles,
    who: "Employees and managers",
    points: [
      "See payslips, leave balance and tax at a glance",
      "Claim expenses with a receipt from your phone",
      "Managers see team attendance and approvals",
    ],
  },
];

export function Audiences() {
  return (
    <section className="bg-muted/40 border-y py-20">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-3xl font-semibold tracking-tight">
          Made for the people who run payday
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.who} className="bg-card rounded-2xl border p-6">
              <a.icon className="text-primary size-6" aria-hidden />
              <h3 className="mt-3 font-semibold">{a.who}</h3>
              <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
                {a.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const PLANS = [
  {
    name: "Starter",
    price: "₹0",
    unit: "for up to 10 employees",
    cta: "Start free",
    points: [
      "Payroll, payslips and statutory deductions",
      "Attendance and leave",
      "Self-serve company setup",
    ],
    featured: false,
  },
  {
    name: "Growth",
    price: "₹49",
    unit: "per employee / month",
    cta: "Start free",
    points: [
      "Everything in Starter",
      "Expenses, tax declarations and compliance",
      "Reports with Excel and PDF export",
      "Audit log export",
    ],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "for large teams",
    cta: "Talk to us",
    points: [
      "Everything in Growth",
      "Single sign-on and custom roles",
      "Priority support and onboarding",
    ],
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
        <p className="text-muted-foreground mt-3">
          Illustrative plans for this demo build. Billing is not live.
        </p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={cn(
              "bg-card relative flex flex-col rounded-2xl border p-6",
              p.featured && "border-primary shadow-lg md:-translate-y-2",
            )}
          >
            {p.featured && (
              <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-0.5 text-xs font-medium">
                Most popular
              </span>
            )}
            <h3 className="font-semibold">{p.name}</h3>
            <p className="mt-3 text-4xl font-semibold tracking-tight">{p.price}</p>
            <p className="text-muted-foreground text-sm">{p.unit}</p>
            <ul className="mt-5 flex-1 space-y-2 text-sm">
              {p.points.map((x) => (
                <li key={x} className="flex gap-2">
                  <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
            <Button asChild variant={p.featured ? "default" : "outline"} className="mt-6">
              <Link href="/signup">{p.cta}</Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

const FAQS = [
  [
    "Which Indian statutes does it cover?",
    "Provident Fund (with the wage ceiling), ESI, state-wise Professional Tax, and TDS under both the old and new regimes, plus gratuity. Rates live in code with the source noted, and you should confirm them against current notifications before your first live run.",
  ],
  [
    "Can it actually pay salaries?",
    "It exports a bank upload CSV and can dispatch payouts through Razorpay. In this build the Razorpay integration runs in test mode only.",
  ],
  [
    "How is employee data protected?",
    "Bank account, PAN and Aadhaar are encrypted with AES-256-GCM. Every table is scoped to a company and protected by Postgres row-level security, and permissions are checked on the server for every action.",
  ],
  [
    "What stops a payroll mistake or fraud?",
    "A second person must approve each run, the run locks once approved, and every change is written to a hash-chained audit log that shows old and new values.",
  ],
  [
    "Is the AI assistant available?",
    "Not yet. The payroll, attendance, leave, expense, tax and reporting features are live; the AI copilot is on the roadmap.",
  ],
  [
    "Can I take my data out?",
    "Yes. Employees export to CSV, reports to Excel and PDF, payroll to a bank file, and the audit log to CSV.",
  ],
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20">
      <h2 className="text-center text-3xl font-semibold tracking-tight">Questions, answered</h2>
      <div className="mt-8 divide-y rounded-2xl border">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {q}
              <span
                aria-hidden
                className="text-muted-foreground transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="text-muted-foreground mt-3 text-sm">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="px-4 pb-20">
      <div className="bg-primary text-primary-foreground relative mx-auto max-w-5xl overflow-hidden rounded-3xl px-6 py-14 text-center">
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{ background: "radial-gradient(60% 80% at 80% 0%, white, transparent)" }}
        />
        <h2 className="relative text-3xl font-semibold tracking-tight">
          Make the next payday the calm one
        </h2>
        <p className="relative mx-auto mt-3 max-w-xl opacity-90">
          Set up your company in minutes and run a draft payroll before you commit to anything.
        </p>
        <Button asChild size="lg" variant="outline" className="text-foreground relative mt-6">
          <Link href={signedIn ? "/dashboard" : "/signup"}>
            {signedIn ? "Open dashboard" : "Create your company"}
          </Link>
        </Button>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm">
        <p>© {new Date().getFullYear()} PayFlow. Payroll and HR for Indian companies.</p>
        <nav aria-label="Footer" className="flex gap-5">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-foreground">
            Sign up
          </Link>
        </nav>
      </div>
    </footer>
  );
}
