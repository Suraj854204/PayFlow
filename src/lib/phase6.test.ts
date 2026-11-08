import { describe, expect, it } from "vitest";
import { detectAnomalies, type PreviousFacts, type RunItemFacts } from "@/lib/anomaly/detect";
import { preRunChecks, summarizeChecks, type CopilotFacts } from "@/lib/copilot/checks";
import { attritionByDepartment, chartFor } from "@/lib/reports/builder";

const base = (o: Partial<RunItemFacts> = {}): RunItemFacts => ({
  employeeId: "e1",
  name: "Asha",
  gross: 100000_00,
  net: 80000_00,
  totalDeductions: 20000_00,
  tds: 3000_00,
  otherDeduction: 0,
  oneOffs: 0,
  lopDays: 0,
  onHold: false,
  accountFingerprint: null,
  joinDate: "2024-01-01",
  exitDate: null,
  attendanceDays: 20,
  ...o,
});
const prev = (e = "e1", net = 80000_00): Map<string, PreviousFacts> =>
  new Map([[e, { net, gross: 100000_00, tds: 3000_00 }]]);
const run = (items: RunItemFacts[], p = prev(), inUse = true) =>
  detectAnomalies("2026-11", items, p, { attendanceInUse: inUse });
const kinds = (a: { kind: string }[]) => a.map((x) => x.kind);

describe("anomaly detection", () => {
  it("is quiet for a normal month", () => expect(run([base()])).toEqual([]));

  it("flags an unexplained pay jump, with numbers in the explanation", () => {
    const a = run([base({ net: 120000_00 })]);
    expect(kinds(a)).toEqual(["salary_spike"]);
    expect(a[0].title).toContain("jumped 50%");
    expect(a[0].severity).toBe("high");
    expect(a[0].explanation).toContain("₹1,20,000.00");
  });
  it("does not flag a jump that a bonus explains", () => {
    expect(run([base({ net: 120000_00, oneOffs: 40000_00 })])).toEqual([]);
  });
  it("does not flag a drop explained by loss of pay, but flags an unexplained drop", () => {
    expect(run([base({ net: 50000_00, lopDays: 6 })])).toEqual([]);
    expect(kinds(run([base({ net: 50000_00 })]))).toEqual(["salary_spike"]);
  });
  it("ignores small absolute changes", () => {
    expect(run([base({ net: 4000_00 })], prev("e1", 2000_00))).toEqual([]);
  });

  it("flags heavy deductions, big manual deductions, doubled TDS and zero take-home", () => {
    expect(kinds(run([base({ totalDeductions: 50000_00, net: 50000_00 })], new Map()))).toEqual([
      "abnormal_deduction",
    ]);
    expect(run([base({ otherDeduction: 25000_00 })], new Map())[0].title).toContain(
      "manual deduction",
    );
    expect(run([base({ tds: 9000_00 })])[0].title).toContain("TDS more than doubled");
    const z = run([base({ net: 0, totalDeductions: 100000_00 })], new Map());
    expect(z.some((x) => x.title.includes("no take-home") && x.severity === "high")).toBe(true);
  });

  it("flags people who left before the month, or join after it", () => {
    expect(run([base({ exitDate: "2026-09-30" })], new Map())[0].title).toContain(
      "left before this month",
    );
    expect(run([base({ joinDate: "2026-12-05" })], new Map())[0].title).toContain(
      "has not joined yet",
    );
  });
  it("flags full pay with no attendance, but only where attendance is used", () => {
    expect(run([base({ attendanceDays: 0 })], new Map())[0].title).toContain("no attendance");
    expect(run([base({ attendanceDays: 0 })], new Map(), false)).toEqual([]);
    expect(run([base({ attendanceDays: 0, lopDays: 22 })], new Map())).toEqual([]);
  });
  it("flags two employees paid into one account, and never shows the account", () => {
    const a = run(
      [
        base({ accountFingerprint: "abc123def456xyz" }),
        base({ employeeId: "e2", name: "Ravi", accountFingerprint: "abc123def456xyz" }),
      ],
      new Map(),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      kind: "duplicate_account",
      severity: "high",
      employeeIds: ["e1", "e2"],
    });
    expect(JSON.stringify(a)).not.toContain("abc123def456xyz");
  });
  it("skips employees on hold and sorts by severity", () => {
    expect(run([base({ onHold: true, net: 0 })], new Map())).toEqual([]);
    const a = run(
      [base({ tds: 9000_00 }), base({ employeeId: "e2", name: "Ravi", exitDate: "2026-01-01" })],
      new Map([["e1", { net: 80000_00, gross: 1, tds: 3000_00 }]]),
    );
    expect(a[0].severity).toBe("high");
    expect(a[a.length - 1].severity).toBe("low");
  });
  it("gives each finding a stable key", () => {
    expect(run([base({ net: 120000_00 })])[0].key).toBe("salary_spike:e1");
  });
});

const facts = (o: Partial<CopilotFacts> = {}): CopilotFacts => ({
  month: "2026-11",
  employeesInRun: 10,
  onHold: 0,
  missingBank: [],
  missingPan: 0,
  attendanceInUse: true,
  attendanceLocked: true,
  pendingLeaveInMonth: 0,
  unattachedApprovedExpenses: 0,
  calcErrors: 0,
  calcWarnings: 0,
  anomalyHigh: 0,
  anomalyMedium: 0,
  overdueCompliance: 0,
  zeroNet: 0,
  ...o,
});
describe("payroll copilot checklist", () => {
  it("is ready when everything is fine", () => {
    const c = preRunChecks(facts());
    expect(c.every((x) => x.status === "pass")).toBe(true);
    expect(summarizeChecks(c)).toMatchObject({ fail: 0, warn: 0, ready: true });
  });
  it("fails on missing bank details and names the people", () => {
    const c = preRunChecks(facts({ missingBank: ["Asha", "Ravi", "Meera", "Dev", "Zoya"] }));
    const b = c.find((x) => x.id === "bank")!;
    expect(b.status).toBe("fail");
    expect(b.detail).toContain("Asha, Ravi, Meera and 2 more");
    expect(b.fixHref).toBe("/employees");
    expect(summarizeChecks(c).ready).toBe(false);
  });
  it("warns, not fails, for an unlocked month, pending leave and missing PAN", () => {
    const c = preRunChecks(
      facts({ attendanceLocked: false, pendingLeaveInMonth: 2, missingPan: 1 }),
    );
    expect(
      c
        .filter((x) => x.status === "warn")
        .map((x) => x.id)
        .sort(),
    ).toEqual(["attendance", "leave", "pan"]);
    expect(summarizeChecks(c).ready).toBe(true);
  });
  it("skips the attendance check when attendance is not used and fails an empty run", () => {
    expect(preRunChecks(facts({ attendanceInUse: false })).some((x) => x.id === "attendance")).toBe(
      false,
    );
    expect(preRunChecks(facts({ employeesInRun: 0 }))[0].status).toBe("fail");
  });
  it("escalates anomalies by severity", () => {
    expect(preRunChecks(facts({ anomalyHigh: 1 })).find((x) => x.id === "anomaly")!.status).toBe(
      "fail",
    );
    expect(preRunChecks(facts({ anomalyMedium: 2 })).find((x) => x.id === "anomaly")!.status).toBe(
      "warn",
    );
  });
});

describe("report builder", () => {
  const people = [
    { department: "Eng", joinDate: "2024-01-01", exitDate: "2026-03-10" },
    { department: "Eng", joinDate: "2024-01-01", exitDate: null },
    { department: "Eng", joinDate: "2024-06-01", exitDate: null },
    { department: "Eng", joinDate: "2024-06-01", exitDate: null },
    { department: "Ops", joinDate: "2025-01-01", exitDate: null },
    { department: "Ops", joinDate: "2026-09-01", exitDate: null },
  ];
  it("computes annualised attrition per department, highest first", () => {
    const r = attritionByDepartment(people, "2026-10", 12);
    expect(r[0]).toMatchObject({ department: "Eng", leavers: 1 });
    expect(r[0].ratePct).toBeGreaterThan(20);
    expect(r.find((x) => x.department === "Ops")!.ratePct).toBe(0);
  });
  it("returns zero for a department with nobody", () => {
    expect(
      attritionByDepartment(
        [{ department: "X", joinDate: "2030-01-01", exitDate: null }],
        "2026-10",
      )[0].ratePct,
    ).toBe(0);
  });
  it("labels charts with the right unit", () => {
    expect(chartFor("attrition_by_department", []).unit).toBe("percent");
    expect(chartFor("cost_by_department", []).kind).toBe("donut");
  });
});

import { figuresAreGrounded, templateExplanation, type PayslipFacts } from "@/lib/ai/explain";

describe("payslip explainer", () => {
  const f: PayslipFacts = {
    monthLabel: "October 2026",
    gross: 5000000,
    deductions: 700000,
    net: 4300000,
    earnings: [
      { code: "BASIC", name: "Basic", amount: 2500000 },
      { code: "HRA", name: "HRA", amount: 2500000 },
    ],
    deductionLines: [
      { code: "PF", name: "PF", amount: 300000 },
      { code: "TDS", name: "TDS", amount: 400000 },
    ],
    lopDays: 2,
    paidDays: 29,
  };
  it("explains in English with real figures", () => {
    const e = templateExplanation(f, "en");
    expect(e.summary).toContain("₹50,000");
    expect(e.summary).toContain("₹43,000");
    expect(e.points.some((p) => p.includes("loss of pay"))).toBe(true);
  });
  it("explains in Hindi", () => {
    const e = templateExplanation(f, "hi");
    expect(e.summary).toContain("आपके खाते में");
    expect(e.points.some((p) => p.includes("भविष्य निधि"))).toBe(true);
  });
  it("rejects figures not on the payslip", () => {
    expect(figuresAreGrounded("You get ₹43,000 and PF is ₹3,000.", f)).toBe(true);
    expect(figuresAreGrounded("You get ₹99,999.", f)).toBe(false);
  });
});
