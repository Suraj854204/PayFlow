import { describe, expect, it } from "vitest";
import { fallbackModel } from "./fallback";
import type { ToolOutcome, Turn } from "./types";

async function answer(results: ToolOutcome[]): Promise<string> {
  const turns = [
    { role: "user", text: "q" },
    { role: "tool", results },
  ] as unknown as Turn[];
  let out = "";
  for await (const c of fallbackModel("2026-11-02").stream({ system: "", turns, tools: [] }))
    if (c.type === "text") out += c.delta;
  return out;
}
const ok = (name: string, response: Record<string, unknown>): ToolOutcome => ({
  name,
  response,
  status: "ok",
});

describe("fallback answers are written from the tool results only", () => {
  it("payslip", async () => {
    const t = await answer([
      ok("my_payslip", {
        found: true,
        month: "2026-10",
        netPay: "₹50,000",
        gross: "₹60,000",
        totalDeductions: "₹10,000",
        earnings: [{ name: "Basic", amount: "₹30,000" }],
        deductions: [{ name: "PF", amount: "₹1,800" }],
        lopDays: 2,
      }),
    ]);
    expect(t).toContain("net pay **₹50,000**");
    expect(t).toContain("Basic: ₹30,000");
    expect(t).toContain("Loss of pay: 2 days");
    expect(await answer([ok("my_payslip", { found: false, note: "No payslip yet." })])).toBe(
      "No payslip yet.",
    );
  });
  it("leave, tax, attendance", async () => {
    expect(
      await answer([
        ok("my_leave_balance", { balances: [{ type: "CL", daysLeft: 5, daysAllotted: 12 }] }),
      ]),
    ).toContain("**CL**: 5 of 12 days left");
    expect(await answer([ok("my_leave_balance", { balances: [] })])).toMatch(/No leave types/);
    const tax = await answer([
      ok("my_tax_summary", {
        regime: "new",
        taxDeductedThisYear: "₹1",
        projectedAnnualTax: "₹2",
        declarationStatus: "none",
        suggestions: [{ title: "80C", detail: "Use it" }],
      }),
    ]);
    expect(tax).toContain("not tax advice");
    expect(tax).toContain("**80C.** Use it");
    expect(
      await answer([
        ok("my_attendance", {
          month: "2026-10",
          present: 20,
          halfDays: 1,
          onLeave: 1,
          absent: 0,
          lateArrivals: 2,
        }),
      ]),
    ).toContain("20 days present");
  });
  it("company reads", async () => {
    expect(
      await answer([
        ok("company_payroll_summary", {
          found: true,
          month: "2026-10",
          status: "paid",
          employees: 50,
          gross: "g",
          deductions: "d",
          netPay: "n",
          employerCost: "e",
        }),
      ]),
    ).toContain("**2026-10** payroll is **paid**");
    expect(
      await answer([
        ok("headcount_summary", { total: 50, byDepartment: [{ department: "Eng", count: 20 }] }),
      ]),
    ).toContain("Eng: 20");
    expect(
      await answer([ok("pending_approvals", { scope: "company", leaveRequests: 3 })]),
    ).toContain("leave requests: **3**");
    expect(
      await answer([
        ok("team_attendance_today", { found: true, members: [{ name: "A", status: "half_day" }] }),
      ]),
    ).toContain("A: half day");
    expect(
      await answer([
        ok("compliance_due", {
          items: [{ overdue: true, filing: "PF", forPeriod: "Oct", dueDate: "15th" }],
        }),
      ]),
    ).toContain("**Overdue** PF");
    expect(await answer([ok("compliance_due", { items: [] })])).toMatch(/Nothing is overdue/);
  });
  it("run checks and reports", async () => {
    const t = await answer([
      ok("check_payroll_run", {
        found: true,
        month: "2026-10",
        status: "draft",
        readyForApproval: false,
        failingChecks: [{ title: "Bank", detail: "missing" }],
        warnings: [{ title: "Late", detail: "x" }],
        anomalies: [{ title: "Spike", severity: "high", why: "w.", whatToDo: "d." }],
      }),
    ]);
    expect(t).toContain("not ready for approval");
    expect(t).toContain("**Fix first**");
    expect(t).toContain("**Spike** (high)");
    expect(
      await answer([
        ok("check_payroll_run", {
          found: true,
          month: "m",
          status: "draft",
          readyForApproval: true,
          failingChecks: [],
          warnings: [],
          anomalies: [],
        }),
      ]),
    ).toContain("No anomalies detected");
    expect(
      await answer([ok("build_report", { report: "Cost", rows: [{ label: "Eng", value: "₹1" }] })]),
    ).toContain("Eng: ₹1");
    expect(
      await answer([ok("build_report", { report: "Cost", rows: [], note: "none" })]),
    ).toContain("none");
  });
  it("policy, proposals, denial and errors", async () => {
    expect(await answer([ok("policy_search", { found: false })])).toMatch(/Please ask HR/);
    const p = await answer([
      ok("policy_search", {
        found: true,
        passages: [{ ref: 1, document: "Leave policy", page: 2, text: "Twelve days." }],
      }),
    ]);
    expect(p).toContain("[1] **Leave policy**, page 2");
    expect(await answer([ok("propose_raise", { proposed: true, summary: "Raise 5%" })])).toContain(
      "Nothing has changed yet",
    );
    expect(await answer([ok("propose_raise", { proposed: false, reason: "too large" })])).toContain(
      "too large",
    );
    expect(await answer([{ name: "x", response: {}, status: "denied" }])).toMatch(
      /do not have access/,
    );
    expect(await answer([{ name: "x", response: {}, status: "error" }])).toMatch(/could not load/);
    expect(await answer([ok("unknown_tool", {})])).toBe("Done.");
  });
});
