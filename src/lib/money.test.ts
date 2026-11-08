import { describe, expect, it } from "vitest";
import {
  allocate,
  assertPaise,
  formatINR,
  formatINRCompact,
  paiseToRupees,
  percentOf,
  rupeesToPaise,
  sum,
} from "./money";

describe("money", () => {
  it("converts rupees to paise without float drift", () => {
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise(1234.5)).toBe(123450);
    expect(rupeesToPaise("-50")).toBe(-5000);
  });

  it("rejects malformed amounts", () => {
    expect(() => rupeesToPaise("12.345")).toThrow();
    expect(() => rupeesToPaise("abc")).toThrow();
    expect(() => rupeesToPaise("")).toThrow();
  });

  it("only accepts safe integers as paise", () => {
    expect(() => assertPaise(10.5)).toThrow();
    expect(() => assertPaise(Number.NaN)).toThrow();
    expect(() => assertPaise(2 ** 60)).toThrow();
    expect(() => assertPaise(100)).not.toThrow();
  });

  it("converts paise to rupees", () => {
    expect(paiseToRupees(123456)).toBe(1234.56);
  });

  it("computes percentages in basis points with half-up rounding", () => {
    expect(percentOf(5_000_000, 1200)).toBe(600_000); // 12% of 50,000
    expect(percentOf(333, 5000)).toBe(167); // 166.5 -> 167
    expect(percentOf(0, 1200)).toBe(0);
  });

  it("sums exactly", () => {
    expect(sum([10, 20, 30])).toBe(60);
    expect(sum([])).toBe(0);
    expect(() => sum([1, 1.5])).toThrow();
  });

  it("allocates remainders so parts always add up to the total", () => {
    const parts = allocate(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(sum(parts)).toBe(100);
    expect(sum(allocate(1, 7))).toBe(1);
    expect(() => allocate(100, 0)).toThrow();
  });

  it("formats INR with Indian digit grouping", () => {
    expect(formatINR(1_23_45_678_00)).toContain("1,23,45,678");
    expect(formatINRCompact(12_00_000_00)).toBe("₹12.00L");
    expect(formatINRCompact(3_50_00_000_00)).toBe("₹3.50Cr");
    expect(formatINRCompact(-5_000_00)).toBe("-₹5.0K");
    expect(formatINRCompact(500_00)).toBe("₹500");
  });
});
