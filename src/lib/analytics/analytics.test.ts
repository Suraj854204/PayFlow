import { describe, expect, it } from "vitest";
import { scoreAttrition, type AttritionFacts } from "./attrition";
import { forecastCost } from "./forecast";
import { equityReport, positionInRange, type PayPerson } from "./equity";

const base: AttritionFacts = {
  id: "a",
  name: "A",
  peerGroup: "dev",
  departmentId: "d1",
  joinDate: "2024-06-01",
  ctcAnnual: 1_000_000_00,
  lastRevisionDate: "2026-06-01",
  absentDaysLast90: 1,
  absentDaysPrev90: 1,
  overtimeMinutesLast90: 0,
};

describe("attrition risk", () => {
  it("scores a stable, fairly paid, recently revised person low", () => {
    const peers = [base, { ...base, id: "b" }, { ...base, id: "c" }];
    const r = scoreAttrition(peers, "2026-11-04")[0];
    expect(r.band).toBe("low");
    expect(r.factors.filter((f) => f.key !== "tenure")).toEqual([]);
  });
  it("explains every point and stacks factors into a high band", () => {
    const risky = {
      ...base,
      id: "x",
      ctcAnnual: 700_000_00,
      lastRevisionDate: "2024-12-01",
      absentDaysLast90: 6,
      overtimeMinutesLast90: 70 * 60,
    };
    const people = [risky, { ...base, id: "b" }, { ...base, id: "c" }, { ...base, id: "d" }];
    const mood = new Map([["d1", { responses: 8, negativeShare: 0.5 }]]);
    const r = scoreAttrition(people, "2026-11-04", mood).find((p) => p.id === "x")!;
    expect(r.band).toBe("high");
    expect(r.score).toBe(
      Math.min(
        100,
        r.factors.reduce((s, f) => s + f.points, 0),
      ),
    );
    expect(r.factors.map((f) => f.key).sort()).toEqual(
      ["absence", "mood", "overtime", "pay", "raise", "tenure"].sort(),
    );
    expect(r.factors.every((f) => f.detail.length > 10)).toBe(true);
  });
  it("ignores peer pay with too few peers and mood with too few responses", () => {
    const r = scoreAttrition(
      [
        { ...base, ctcAnnual: 100 },
        { ...base, id: "b" },
      ],
      "2026-11-04",
      new Map([["d1", { responses: 2, negativeShare: 1 }]]),
    )[0];
    expect(r.factors.some((f) => f.key === "pay" || f.key === "mood")).toBe(false);
  });
  it("caps the score at 100", () => {
    const r = scoreAttrition([{ ...base, lastRevisionDate: "2020-01-01" }], "2026-11-04")[0];
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("cost forecast", () => {
  const input = {
    fromMonth: "2026-10",
    baselineMonthlyCost: 100_000_000,
    headcount: 100,
    monthlyAttritionRate: 0,
    backfill: false,
    hires: [],
    incrementRate: 0,
  };
  it("is flat with no plan", () => {
    const rows = forecastCost(input);
    expect(rows).toHaveLength(6);
    expect(rows[0].month).toBe("2026-11");
    expect(new Set(rows.map((r) => r.cost)).size).toBe(1);
  });
  it("adds hires from their start month onward, with on-costs", () => {
    const rows = forecastCost({
      ...input,
      hires: [{ month: "2026-12", count: 2, ctcAnnual: 12_00_000_00 }],
      onCostRate: 0.1,
    });
    expect(rows[0].cost).toBe(100_000_000);
    expect(rows[1].cost).toBe(100_000_000 + Math.round(2 * 1_00_000_00 * 1.1));
    expect(rows[1].headcount).toBe(102);
    expect(rows[5].parts.hires).toBe(rows[1].parts.hires);
  });
  it("applies the increment once from its month", () => {
    const rows = forecastCost({ ...input, incrementRate: 0.1, incrementMonth: "2027-01" });
    expect(rows[1].cost).toBe(100_000_000);
    expect(rows[2].cost).toBe(110_000_000);
    expect(rows[5].cost).toBe(110_000_000);
  });
  it("attrition saves cost and backfill brings it back", () => {
    const leaving = forecastCost({ ...input, monthlyAttritionRate: 0.02 });
    expect(leaving[5].cost).toBeLessThan(input.baselineMonthlyCost);
    const backfilled = forecastCost({ ...input, monthlyAttritionRate: 0.02, backfill: true });
    expect(backfilled[5].cost).toBeGreaterThan(leaving[5].cost);
    expect(backfilled[5].headcount).toBeGreaterThan(leaving[5].headcount);
  });
});

describe("pay equity", () => {
  const mk = (n: number, gender: PayPerson["gender"], role: string, ctc: number): PayPerson[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${gender}${role}${i}`,
      gender,
      role,
      roleLabel: role,
      ctcAnnual: ctc,
    }));
  it("shows no gap for equal pay and a gap when women are paid less", () => {
    const equal = equityReport([
      ...mk(4, "male", "dev", 10_00_000_00),
      ...mk(4, "female", "dev", 10_00_000_00),
    ]);
    expect(equal.adjustedGapPercent).toBe(0);
    const gap = equityReport([
      ...mk(4, "male", "dev", 10_00_000_00),
      ...mk(4, "female", "dev", 9_00_000_00),
    ]);
    expect(gap.adjustedGapPercent).toBe(10);
    expect(gap.roles[0].gapPercent).toBe(10);
  });
  it("separates a role-mix gap from a like-for-like gap", () => {
    const r = equityReport([
      ...mk(4, "male", "senior", 20_00_000_00),
      ...mk(1, "female", "senior", 20_00_000_00),
      ...mk(1, "male", "junior", 6_00_000_00),
      ...mk(4, "female", "junior", 6_00_000_00),
    ]);
    expect(r.adjustedGapPercent).toBe(null); // groups too small within each role
    expect(r.suppressedRoles).toBe(2);
    const bigger = equityReport([
      ...mk(6, "male", "senior", 20_00_000_00),
      ...mk(3, "female", "senior", 20_00_000_00),
      ...mk(3, "male", "junior", 6_00_000_00),
      ...mk(6, "female", "junior", 6_00_000_00),
    ]);
    expect(bigger.adjustedGapPercent).toBe(0);
    expect(bigger.unadjustedGapPercent).toBeGreaterThan(0); // pure role mix
  });
  it("never reports a gap from groups under the minimum", () => {
    const r = equityReport([
      ...mk(2, "male", "dev", 10_00_000_00),
      ...mk(5, "female", "dev", 5_00_000_00),
    ]);
    expect(r.roles).toEqual([]);
    expect(r.unadjustedGapPercent).toBeNull();
  });
  it("places a salary against a market range", () => {
    const b = { p25: 8_00_000_00, p50: 10_00_000_00, p75: 12_00_000_00 };
    expect(positionInRange(7_00_000_00, b)).toEqual({ compaRatio: 0.7, band: "below" });
    expect(positionInRange(10_00_000_00, b).band).toBe("within");
    expect(positionInRange(13_00_000_00, b).band).toBe("above");
  });
});
