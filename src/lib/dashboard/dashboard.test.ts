import { describe, expect, it } from "vitest";
import { describeAction } from "./activity";
import { nextDayOfMonth, payrollCountdown } from "./countdown";
import { buildInsights, type InsightFacts } from "./insights";
import { taxTips, type TipFacts } from "./tips";

const calm: InsightFacts = {
  pendingPayrollApprovals: 0,
  pendingLeave: 0,
  pendingExpenses: 0,
  pendingDeclarations: 0,
  missingBank: 0,
  missingPan: 0,
  overdueCompliance: 0,
  dueSoonCompliance: 0,
  costChangePct: null,
  latestCost: null,
  attendanceUnlockedMonth: null,
  probationEnding: 0,
  daysToCutoff: 20,
  currentMonthRun: "draft",
};

describe("payroll countdown", () => {
  it("finds the next occurrence of a day, rolling into next month", () => {
    expect(nextDayOfMonth("2026-11-01", 25)).toBe("2026-11-25");
    expect(nextDayOfMonth("2026-11-25", 25)).toBe("2026-11-25");
    expect(nextDayOfMonth("2026-11-26", 25)).toBe("2026-12-25");
  });
  it("clamps to short months and crosses the year", () => {
    expect(nextDayOfMonth("2027-02-10", 31)).toBe("2027-02-28");
    expect(nextDayOfMonth("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("counts days to cutoff and pay day", () => {
    const c = payrollCountdown("2026-11-20", 1, 25);
    expect(c).toMatchObject({
      cutoffDate: "2026-11-25",
      daysToCutoff: 5,
      payDate: "2026-12-01",
      daysToPay: 11,
    });
  });
});

describe("insights", () => {
  it("says all clear when nothing is wrong", () => {
    const r = buildInsights(calm);
    expect(r).toHaveLength(1);
    expect(r[0].tone).toBe("success");
  });
  it("orders by severity and counts correctly", () => {
    const r = buildInsights({
      ...calm,
      pendingLeave: 2,
      pendingExpenses: 1,
      missingBank: 1,
      overdueCompliance: 3,
      pendingPayrollApprovals: 1,
    });
    expect(r.map((i) => i.tone)).toEqual(["danger", "danger", "warning", "info"]);
    expect(r.find((i) => i.id === "queues")?.title).toBe("3 requests waiting for a decision");
    expect(r.find((i) => i.id === "missing-bank")?.title).toBe("1 employee without bank details");
  });
  it("warns about an unstarted run only near the cutoff", () => {
    expect(
      buildInsights({ ...calm, currentMonthRun: "none", daysToCutoff: 9 }).some(
        (i) => i.id === "run-not-started",
      ),
    ).toBe(false);
    expect(
      buildInsights({ ...calm, currentMonthRun: "none", daysToCutoff: 3 }).some(
        (i) => i.id === "run-not-started",
      ),
    ).toBe(true);
  });
  it("flags only meaningful cost swings", () => {
    expect(
      buildInsights({ ...calm, costChangePct: 3, latestCost: 100 }).some(
        (i) => i.id === "cost-change",
      ),
    ).toBe(false);
    const up = buildInsights({ ...calm, costChangePct: -12, latestCost: 100000_00 }).find(
      (i) => i.id === "cost-change",
    );
    expect(up?.title).toContain("fell 12%");
  });
});

describe("tax tips", () => {
  const base: TipFacts = {
    regime: "old",
    declarationStatus: "verified",
    section80C: 50000_00,
    section80D: 0,
    annualRent: 0,
    employeePfAnnual: 60000_00,
    hraAnnual: 120000_00,
    compare: null,
  };
  it("computes 80C headroom including PF", () => {
    const t = taxTips(base).find((x) => x.id === "80c");
    expect(t?.title).toContain("₹40,000.00");
  });
  it("suggests 80D and rent only under the old regime", () => {
    const ids = taxTips(base).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["80d", "hra"]));
    expect(taxTips({ ...base, regime: "new" }).map((t) => t.id)).toEqual([]);
  });
  it("recommends a regime switch only when it saves money", () => {
    expect(
      taxTips({ ...base, regime: "new", compare: { better: "old", saving: 20000_00 } })[0].id,
    ).toBe("regime");
    expect(taxTips({ ...base, regime: "new", compare: { better: "new", saving: 0 } })).toEqual([]);
  });
  it("nudges to submit when no declaration exists", () => {
    expect(
      taxTips({ ...base, regime: "new", declarationStatus: "none" }).map((t) => t.id),
    ).toContain("submit");
  });
});

describe("activity labels", () => {
  it("uses friendly text and falls back to a readable form", () => {
    expect(describeAction("payroll_run.approved")).toBe("approved a payroll run");
    expect(describeAction("weird_thing.did_stuff")).toBe("did stuff weird thing");
  });
});
