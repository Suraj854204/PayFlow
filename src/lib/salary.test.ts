import { describe, expect, it } from "vitest";
import { computeBreakdown, DEFAULT_COMPONENTS, describeCalc, type SalaryLineInput } from "./salary";
import { rupeesToPaise, sum } from "./money";

const std = DEFAULT_COMPONENTS.map(({ position: _p, ...l }) => {
  void _p;
  return l;
});
const ctc = (rupees: number) => rupeesToPaise(rupees);

function ok(annual: number, lines: SalaryLineInput[] = std) {
  const r = computeBreakdown(annual, lines);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.breakdown;
}
const byCode = (b: ReturnType<typeof ok>, code: string) => b.lines.find((l) => l.code === code)!;

describe("computeBreakdown", () => {
  it("splits a 12 LPA CTC with the standard structure", () => {
    const b = ok(ctc(1_200_000));
    expect(b.ctcMonthly).toBe(ctc(100_000));
    expect(byCode(b, "BASIC").monthly).toBe(ctc(50_000));
    expect(byCode(b, "HRA").monthly).toBe(ctc(20_000)); // 40% of basic
    expect(byCode(b, "SPECIAL").monthly).toBe(ctc(30_000)); // balancing
    expect(b.grossMonthly).toBe(b.ctcMonthly);
    expect(b.basicMonthly).toBe(ctc(50_000));
  });

  it("always makes earnings add up to exactly the monthly CTC when a balancing figure exists", () => {
    for (const annual of [ctc(300_000), ctc(487_321), ctc(999_999.99 - 0.99), 123_456_789, 7]) {
      const r = computeBreakdown(annual, std);
      if (!r.ok) continue; // tiny CTCs may be rejected, that is tested separately
      expect(r.breakdown.grossMonthly).toBe(r.breakdown.ctcMonthly);
      expect(sum(r.breakdown.lines.map((l) => l.monthly))).toBe(r.breakdown.ctcMonthly);
    }
  });

  it("annual equals monthly x 12 for every line", () => {
    const b = ok(ctc(840_000));
    for (const l of b.lines) expect(l.annual).toBe(l.monthly * 12);
  });

  it("supports fixed components and deductions and computes net", () => {
    const lines: SalaryLineInput[] = [
      ...std,
      {
        code: "CONV",
        name: "Conveyance",
        type: "earning",
        calcType: "fixed",
        value: ctc(1600),
        isTaxable: false,
        isPfWage: false,
      },
      {
        code: "TDSX",
        name: "Canteen",
        type: "deduction",
        calcType: "fixed",
        value: ctc(500),
        isTaxable: false,
        isPfWage: false,
      },
    ];
    const b = ok(ctc(600_000), lines);
    expect(byCode(b, "SPECIAL").monthly).toBe(ctc(50_000) - ctc(25_000) - ctc(10_000) - ctc(1600));
    expect(b.deductionsMonthly).toBe(ctc(500));
    expect(b.netMonthly).toBe(b.grossMonthly - ctc(500));
  });

  it("works without a balancing component", () => {
    const lines = std.filter((l) => l.code !== "SPECIAL");
    const b = ok(ctc(600_000), lines);
    expect(b.grossMonthly).toBe(ctc(25_000) + ctc(10_000));
  });

  it("rejects earnings that exceed CTC and reports by how much", () => {
    const lines: SalaryLineInput[] = [
      ...std,
      {
        code: "BONUS",
        name: "Bonus",
        type: "earning",
        calcType: "fixed",
        value: ctc(80_000),
        isTaxable: true,
        isPfWage: false,
      },
    ];
    const r = computeBreakdown(ctc(600_000), lines);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/exceed the monthly CTC by/);
  });

  it("rejects earnings above CTC even with no balancing figure", () => {
    const lines = std.filter((l) => l.code !== "SPECIAL");
    lines.push({
      code: "BONUS",
      name: "Bonus",
      type: "earning",
      calcType: "fixed",
      value: ctc(80_000),
      isTaxable: true,
      isPfWage: false,
    });
    expect(computeBreakdown(ctc(600_000), lines).ok).toBe(false);
  });

  it("validates structure rules", () => {
    const two = [...std, { ...std[2], code: "OTHER", name: "Other" }];
    expect(computeBreakdown(ctc(600_000), two)).toMatchObject({ ok: false });
    expect(
      computeBreakdown(
        ctc(600_000),
        std.filter((l) => l.code !== "BASIC"),
      ),
    ).toMatchObject({ ok: false });
    const dup = [...std, { ...std[0] }];
    const r = computeBreakdown(ctc(600_000), dup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/more than once/);
  });

  it("BASIC cannot depend on itself or be a balancing figure", () => {
    const bad = std.map((l) =>
      l.code === "BASIC" ? { ...l, calcType: "percent_of_basic" as const } : l,
    );
    expect(computeBreakdown(ctc(600_000), bad).ok).toBe(false);
    const bal = std.map((l) => (l.code === "BASIC" ? { ...l, calcType: "balancing" as const } : l));
    expect(computeBreakdown(ctc(600_000), bal).ok).toBe(false);
  });

  it("rejects a deduction as the balancing figure and percentages over 100%", () => {
    const bad = std.map((l) => (l.code === "SPECIAL" ? { ...l, type: "deduction" as const } : l));
    expect(computeBreakdown(ctc(600_000), bad).ok).toBe(false);
    const over = std.map((l) => (l.code === "HRA" ? { ...l, value: 10_001 } : l));
    expect(computeBreakdown(ctc(600_000), over).ok).toBe(false);
  });

  it("rejects non-positive or fractional CTC", () => {
    expect(computeBreakdown(0, std).ok).toBe(false);
    expect(computeBreakdown(-5, std).ok).toBe(false);
    expect(computeBreakdown(100.5, std).ok).toBe(false);
  });

  it("rejects deductions larger than gross", () => {
    const lines: SalaryLineInput[] = [
      ...std,
      {
        code: "BIG",
        name: "Big",
        type: "deduction",
        calcType: "fixed",
        value: ctc(500_000),
        isTaxable: false,
        isPfWage: false,
      },
    ];
    expect(computeBreakdown(ctc(600_000), lines).ok).toBe(false);
  });

  it("handles crore-level CTC without overflow", () => {
    const b = ok(ctc(5_00_00_000));
    expect(b.ctcMonthly).toBe(Math.floor(ctc(5_00_00_000) / 12));
    expect(Number.isSafeInteger(b.grossMonthly)).toBe(true);
  });

  it("describes calculations for the UI", () => {
    expect(describeCalc({ calcType: "percent_of_ctc", value: 5000 })).toBe("50% of CTC");
    expect(describeCalc({ calcType: "percent_of_basic", value: 4000 })).toBe("40% of Basic");
    expect(describeCalc({ calcType: "balancing", value: 0 })).toBe("Balancing figure");
    expect(describeCalc({ calcType: "fixed", value: 160_000 })).toContain("1,600");
  });
});
