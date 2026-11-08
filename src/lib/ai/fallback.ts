import type { ChatModel, ModelChunk, ToolCall, ToolOutcome } from "./types";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "October", "oct 2026", "2026-10", "last month" -> YYYY-MM, or undefined for "latest". */
export function parseMonth(text: string, today: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const [y, m] = today.split("-").map(Number);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  if (/\blast month\b|\bprevious month\b/i.test(text)) return shift(-1);
  if (/\bthis month\b|\bcurrent month\b/i.test(text)) return shift(0);
  const lower = text.toLowerCase();
  const idx = MONTHS.findIndex((n) => new RegExp(`\\b${n}\\b|\\b${n.slice(0, 3)}\\b`).test(lower));
  if (idx >= 0) {
    const yr = lower.match(/\b(20\d{2})\b/)?.[1];
    const year = yr ? Number(yr) : idx + 1 > m ? y - 1 : y;
    return `${year}-${String(idx + 1).padStart(2, "0")}`;
  }
  return undefined;
}

type Rule = {
  test: RegExp;
  call: (
    month: string | undefined,
    text: string,
  ) => { name: string; args: Record<string, unknown> } | null;
};
const NAME = String.raw`([a-z][a-z .'-]{1,40}?)`;
const ACTION_RULES: Rule[] = [
  {
    test: new RegExp(
      String.raw`\b(approve|accept)\b.*\bleave\b|\b(approve|accept)\b\s+${NAME}['’]?s?\s+leave`,
      "i",
    ),
    call: (_m, t) => {
      const who = t.match(
        new RegExp(String.raw`(?:approve|accept)\s+${NAME}['’]?s?\s+(?:leave|request)`, "i"),
      )?.[1];
      return who ? { name: "propose_approve_leave", args: { employeeName: who.trim() } } : null;
    },
  },
  {
    test: /\b(reject|decline|deny)\b.*\bleave\b/i,
    call: (_m, t) => {
      const who = t.match(
        new RegExp(String.raw`(?:reject|decline|deny)\s+${NAME}['’]?s?\s+(?:leave|request)`, "i"),
      )?.[1];
      return who ? { name: "propose_reject_leave", args: { employeeName: who.trim() } } : null;
    },
  },
  {
    test: /\bcancel\b.*\bpayroll\b/i,
    call: (m) => (m ? { name: "propose_cancel_payroll_run", args: { month: m } } : null),
  },
  {
    test: /\b(create|start|make|prepare)\b.*\bpayroll\b.*\b(draft|run)\b|\bpayroll (draft|run) for\b/i,
    call: (m) => (m ? { name: "propose_create_payroll_draft", args: { month: m } } : null),
  },
  {
    test: /\b(raise|increase|hike|bump)\b.*\d+(\.\d+)?\s*%/i,
    call: (_m, t) => {
      const pct = t.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
      const dept =
        t.match(
          /\b(?:raise|increase|hike|bump)\s+(?:the\s+)?([a-z][a-z &-]{1,30}?)(?:\s+(?:team|department|dept))?(?:'s)?\s+(?:salar\w*|pay|ctc|bonus|compensation)/i,
        )?.[1] ??
        t.match(
          /\b(?:for|in)\s+(?:the\s+)?([a-z][a-z &-]{1,30}?)\s+(?:team|department|dept)/i,
        )?.[1];
      return pct && dept
        ? {
            name: "propose_department_raise",
            args: { department: dept.trim(), percent: Number(pct) },
          }
        : null;
    },
  },
];
const RULES: Rule[] = [
  {
    test: /polic(y|ies)|handbook|notice period|probation|work from home|\bwfh\b|dress code|code of conduct|maternity|paternity|per diem|travel allowance|resignation process|holiday list/i,
    call: (_m, t) => ({ name: "policy_search", args: { question: t.slice(0, 300) } }),
  },
  {
    test: /attrition|turnover|leavers?|resign/i,
    call: () => ({ name: "build_report", args: { kind: "attrition_by_department" } }),
  },
  {
    test: /(cost|spend|salary|payroll).*(department|dept)|(department|dept).*(cost|spend|salary|payroll)/i,
    call: () => ({ name: "build_report", args: { kind: "cost_by_department" } }),
  },
  {
    test: /headcount.*(trend|over time|history|month)|(trend|growth).*headcount/i,
    call: () => ({ name: "build_report", args: { kind: "headcount_trend" } }),
  },
  {
    test: /overtime|\bot hours\b/i,
    call: () => ({ name: "build_report", args: { kind: "overtime_trend" } }),
  },
  {
    test: /(payroll|cost).*(trend|over time|history)|(trend|history).*(payroll|cost)/i,
    call: () => ({ name: "build_report", args: { kind: "payroll_cost_trend" } }),
  },
  {
    test: /anomal|ready to approve|check (the )?(payroll|run)|review (the )?(payroll|run)|problems?\b|errors?\b|suspicious|ghost|duplicate/i,
    call: (m) => ({ name: "check_payroll_run", args: m ? { month: m } : {} }),
  },
  {
    test: /compliance|\bpf\b|\besi\b|challan|filings?|due soon|deadline|\btds\b.*(deposit|due)/i,
    call: () => ({ name: "compliance_due", args: {} }),
  },
  {
    test: /pending|waiting|to approve|approvals?\b/i,
    call: () => ({ name: "pending_approvals", args: {} }),
  },
  {
    test: /team|reports|who (is|are).*(in|on leave|absent|late)|on leave today/i,
    call: () => ({ name: "team_attendance_today", args: {} }),
  },
  {
    test: /headcount|how many employees|employee count/i,
    call: () => ({ name: "headcount_summary", args: {} }),
  },
  {
    test: /tax|80c|80d|\bhra\b|regime|save|saving/i,
    call: () => ({ name: "my_tax_summary", args: {} }),
  },
  {
    test: /leave (balance|left|days)|how many (leaves?|days off)|leaves? (do i have|left|remaining)/i,
    call: () => ({ name: "my_leave_balance", args: {} }),
  },
  {
    test: /attendance|check.?in|late|present|absent/i,
    call: (m) => ({ name: "my_attendance", args: m ? { month: m } : {} }),
  },
  {
    test: /(total|company|overall).*(payroll|cost)|payroll (summary|total|status)|summari[sz]e.*payroll|payroll.*(this|last) month/i,
    call: (m) => ({ name: "company_payroll_summary", args: m ? { month: m } : {} }),
  },
  {
    test: /payslip|pay slip|net pay|take.?home|salary|\bpay\b|deduct/i,
    call: (m) => ({ name: "my_payslip", args: m ? { month: m } : {} }),
  },
];

/** Maps a message to at most three tool calls. Order of RULES is priority. */
export function routeIntent(text: string, today: string): ToolCall[] {
  const month = parseMonth(text, today);
  const calls: ToolCall[] = [];
  // Action requests win: "approve Rahul's leave" must not be read as a leave-balance question.
  for (const r of ACTION_RULES) {
    if (!r.test.test(text)) continue;
    const c = r.call(month, text);
    if (c) return [{ id: "fb-0", name: c.name, args: c.args }];
  }
  for (const r of RULES) {
    if (!r.test.test(text)) continue;
    const c = r.call(month, text);
    if (!c) continue;
    if (calls.some((x) => x.name === c.name)) continue;
    calls.push({ id: `fb-${calls.length}`, name: c.name, args: c.args });
    if (calls.length === 3) break;
  }
  if (calls.length === 0 && /leave/i.test(text))
    calls.push({ id: "fb-0", name: "my_leave_balance", args: {} });
  // A match the user may not use is still returned: the executor denies it and the answer says so.
  return calls;
}

const CAPABILITY: Record<string, string> = {
  my_payslip: "your payslips",
  my_leave_balance: "your leave balance",
  my_tax_summary: "your tax position and tax-saving pointers",
  my_attendance: "your attendance",
  company_payroll_summary: "company payroll totals",
  headcount_summary: "headcount by department",
  pending_approvals: "approvals waiting for a decision",
  team_attendance_today: "your team's attendance today",
  compliance_due: "PF, ESI, PT and TDS deadlines",
  check_payroll_run: "a pre-approval review of a payroll run, with anomalies",
  propose_approve_leave: "approving or rejecting a leave request (you confirm first)",
  propose_create_payroll_draft: "creating a payroll draft (you confirm first)",
  propose_department_raise: "a department-wide salary revision (you confirm first)",
  policy_search: "questions about your HR policies, with the page cited",
  build_report: "charts such as attrition by department, cost by department and trends",
};

type R = Record<string, unknown>;
const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
const rows = (v: unknown) => (Array.isArray(v) ? (v as R[]) : []);

const COMPOSE: Record<string, (r: R) => string> = {
  my_payslip: (r) =>
    r.found
      ? `**${r.month}**: net pay **${r.netPay}** (gross ${r.gross}, deductions ${r.totalDeductions}).\n\n**Earnings**\n${list(rows(r.earnings).map((l) => `${l.name}: ${l.amount}`))}\n\n**Deductions**\n${list(rows(r.deductions).map((l) => `${l.name}: ${l.amount}`))}${Number(r.lopDays) > 0 ? `\n\nLoss of pay: ${r.lopDays} days.` : ""}`
      : String(r.note ?? "I could not find that payslip."),
  my_leave_balance: (r) =>
    rows(r.balances).length
      ? `Your leave balance this financial year:\n\n${list(rows(r.balances).map((b) => `**${b.type}**: ${b.daysLeft} of ${b.daysAllotted} days left`))}`
      : "No leave types are set up yet.",
  my_tax_summary: (r) =>
    `You are on the **${r.regime}** regime. Tax deducted so far this year: **${r.taxDeductedThisYear}**. Projected tax for the year: **${r.projectedAnnualTax}**. Declaration status: ${r.declarationStatus}.${rows(r.suggestions).length ? `\n\n**Pointers from your own declaration**\n${list(rows(r.suggestions).map((s) => `**${s.title}.** ${s.detail}`))}` : "\n\nNo further suggestions right now."}\n\n_These are general pointers, not tax advice. Confirm with a professional._`,
  my_attendance: (r) =>
    `**${r.month}**: ${r.present} days present, ${r.halfDays} half days, ${r.onLeave} on leave, ${r.absent} absent, ${r.lateArrivals} late arrivals.`,
  company_payroll_summary: (r) =>
    r.found
      ? `**${r.month}** payroll is **${r.status}**: ${r.employees} employees, gross ${r.gross}, deductions ${r.deductions}, net pay **${r.netPay}**, employer cost ${r.employerCost}.`
      : String(r.note),
  headcount_summary: (r) =>
    `**${r.total}** active employees.\n\n${list(rows(r.byDepartment).map((d) => `${d.department}: ${d.count}`))}`,
  pending_approvals: (r) =>
    `Waiting for a decision (${r.scope}):\n\n${list(
      Object.entries(r)
        .filter(([k]) => k !== "scope")
        .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: **${v}**`),
    )}`,
  team_attendance_today: (r) =>
    r.found
      ? `Your team today:\n\n${list(rows(r.members).map((m) => `${m.name}: ${String(m.status).replace("_", " ")}`))}`
      : String(r.note),
  compliance_due: (r) =>
    rows(r.items).length
      ? `Filings due in the next 30 days:\n\n${list(rows(r.items).map((i) => `${i.overdue ? "**Overdue** " : ""}${i.filing} for ${i.forPeriod}, due ${i.dueDate}`))}`
      : "Nothing is overdue or due in the next 30 days.",
  check_payroll_run: (r) => {
    if (!r.found) return String(r.note ?? "There is no run to review.");
    const fails = rows(r.failingChecks);
    const warns = rows(r.warnings);
    const an = rows(r.anomalies);
    return `**${r.month}** run (${r.status}): ${r.readyForApproval ? "no blocking problems found" : "**not ready for approval**"}.${fails.length ? `\n\n**Fix first**\n${list(fails.map((f) => `${f.title}. ${f.detail}`))}` : ""}${warns.length ? `\n\n**Worth a look**\n${list(warns.map((f) => `${f.title}. ${f.detail}`))}` : ""}${an.length ? `\n\n**Anomalies**\n${list(an.map((a) => `**${a.title}** (${a.severity}). ${a.why} ${a.whatToDo}`))}` : "\n\nNo anomalies detected."}`;
  },
  build_report: (r) =>
    rows(r.rows).length
      ? `${r.report}:\n\n${list(rows(r.rows).map((x) => `${x.label}: ${x.value}`))}`
      : `${r.report}: ${r.note ?? "no data yet"}.`,
};

function composePolicy(r: R): string {
  if (!r.found) return "I could not find that in your company's uploaded policies. Please ask HR.";
  const ps = (r.passages as { ref: number; document: string; page: number; text: string }[]).slice(
    0,
    2,
  );
  return (
    "Here is what your company's policies say:\n\n" +
    ps
      .map(
        (p) =>
          `> ${p.text.replace(/\s+/g, " ").slice(0, 500)}${p.text.length > 500 ? "…" : ""}\n\n[${p.ref}] **${p.document}**, page ${p.page}`,
      )
      .join("\n\n") +
    "\n\nThis is quoted from the document; ask HR if anything is unclear."
  );
}

function compose(results: ToolOutcome[]): string {
  const parts: string[] = [];
  for (const r of results) {
    if (r.status === "denied")
      parts.push(
        "You do not have access to that in PayFlow. Ask your HR or Finance team if you need it.",
      );
    else if (r.status === "error")
      parts.push("I could not load that right now. Please try again in a moment.");
    else if (r.name === "policy_search") parts.push(composePolicy(r.response));
    else if (r.name.startsWith("propose_"))
      parts.push(
        r.response.proposed
          ? `I have prepared this for you: ${String(r.response.summary)}\n\n**Nothing has changed yet.** Review the card below, then confirm or cancel.`
          : `I could not prepare that: ${String(r.response.reason ?? "the request was not valid")}`,
      );
    else parts.push((COMPOSE[r.name] ?? (() => "Done."))(r.response));
  }
  return parts.join("\n\n---\n\n");
}

/**
 * The built-in engine: no language model. It routes a message to the same permission-checked tools
 * with keyword rules and writes the answer from templates. Used when no Gemini key is configured and
 * when Gemini fails, so PayBot never goes silent.
 */
export function fallbackModel(today: string): ChatModel {
  return {
    name: "fallback",
    engine: "fallback",
    async *stream({ turns, tools }): AsyncGenerator<ModelChunk> {
      const last = turns[turns.length - 1];
      const emit = (s: string): ModelChunk[] =>
        s.split(/(?<=\s)/).map((delta) => ({ type: "text", delta }));
      if (last?.role === "tool") {
        for (const c of emit(compose(last.results))) yield c;
        return;
      }
      const user = [...turns].reverse().find((t) => t.role === "user");
      const text = user?.role === "user" ? user.text : "";
      const calls = routeIntent(text, today);
      if (calls.length) return void (yield { type: "calls", calls });
      const can = tools.map((t) => CAPABILITY[t.name]).filter(Boolean);
      const help = can.length
        ? `I can help with:\n\n${list(can)}\n\nTry asking one of those, for example "What was my net pay last month?"`
        : "I do not have any tools available for your role yet.";
      for (const c of emit(`I did not quite get that. ${help}`)) yield c;
    },
  };
}
