import { describe, expect, it } from "vitest";
import { compareCtc, simulate } from "./simulate";
import { compareRegimes, NO_DECLARATIONS } from "@/lib/payroll/tax";

const rs = (n: number) => n * 100;
const base = { month: "2026-11", workState: "Karnataka", gender: "male" as const };

describe("what-if simulator", () => {
  it("rejects an invalid CTC with a readable error", () => {
    const r = simulate({ ...base, ctcAnnual: 0 });
    expect(r.ok).toBe(false);
  });

  it("covers all 12 months and take-home is below gross", () => {
    const r = simulate({ ...base, ctcAnnual: rs(12_00_000) });
    if (!r.ok) throw new Error("expected ok");
    expect(r.new.monthly).toHaveLength(12);
    expect(r.new.monthly[0].month).toBe("2026-04");
    expect(r.new.monthly[11].month).toBe("2027-03");
    expect(r.new.monthlyTakeHome).toBeLessThan(r.grossMonthly);
    expect(r.new.annualTakeHome).toBe(r.new.monthly.reduce((s, m) => s + m.net, 0));
  });

  it("annual tax withheld matches the standalone regime comparison", () => {
    const ctc = rs(24_00_000);
    const r = simulate({ ...base, ctcAnnual: ctc });
    if (!r.ok) throw new Error("expected ok");
    // Taxable earnings equal CTC here (all components taxable); employee PF and PT are the old-regime deductions.
    const cmp = compareRegimes(ctc, r.old.annualPf, r.old.annualPt, NO_DECLARATIONS);
    // TDS is rounded monthly, so allow a few rupees of drift.
    expect(Math.abs(r.new.annualTax - cmp.newTax)).toBeLessThan(rs(50));
    expect(Math.abs(r.old.annualTax - cmp.oldTax)).toBeLessThan(rs(50));
  });

  it("old regime wins only with large deductions, new regime wins without", () => {
    const none = simulate({ ...base, ctcAnnual: rs(15_00_000) });
    if (!none.ok) throw new Error("expected ok");
    expect(none.better).toBe("new");
    const heavy = simulate({
      ...base,
      ctcAnnual: rs(15_00_000),
      declarations: {
        section80C: rs(1_50_000),
        section80D: rs(50_000),
        hraExemption: rs(3_00_000),
        otherDeductions: rs(50_000),
      },
    });
    if (!heavy.ok) throw new Error("expected ok");
    expect(heavy.old.annualTax).toBeLessThan(none.old.annualTax);
    expect(heavy.better).toBe("old");
    expect(heavy.annualAdvantage).toBeGreaterThan(0);
  });

  it("a raise increases take-home by less than the raise (tax takes a share)", () => {
    const c = compareCtc({ ...base, ctcAnnual: rs(12_00_000) }, rs(18_00_000));
    if (!c.ok) throw new Error("expected ok");
    expect(c.takeHomeDelta.new).toBeGreaterThan(0);
    expect(c.takeHomeDelta.new * 12).toBeLessThan(rs(6_00_000));
    expect(c.marginalKeepBp).toBeGreaterThan(5000);
    expect(c.marginalKeepBp).toBeLessThan(10000);
  });

  it("is deterministic and never produces fractional paise", () => {
    const a = simulate({ ...base, ctcAnnual: rs(9_87_654) });
    const b = simulate({ ...base, ctcAnnual: rs(9_87_654) });
    expect(a).toEqual(b);
    if (!a.ok) throw new Error("expected ok");
    for (const m of [...a.new.monthly, ...a.old.monthly])
      expect(Number.isInteger(m.net)).toBe(true);
  });
});
