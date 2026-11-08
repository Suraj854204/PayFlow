import { describe, expect, it } from "vitest";
import {
  availableAdvance,
  decideRequest,
  DEFAULT_EWA_POLICY as P,
  earnedShare,
  type EwaFacts,
} from "./rules";

const facts = (o: Partial<EwaFacts> = {}): EwaFacts => ({
  earnedSoFar: 40_000_00,
  netMonthly: 80_000_00,
  alreadyDrawn: 0,
  requestsThisMonth: 0,
  otherDeductionsDue: 0,
  ...o,
});

describe("earned wage access rules", () => {
  it("allows up to the percentage of what is earned, within the cap", () => {
    expect(availableAdvance(facts(), P)).toBe(20_000_00); // 50% of 40k = 20k = cap
    expect(availableAdvance(facts({ earnedSoFar: 10_000_00 }), P)).toBe(5_000_00);
  });
  it("subtracts what was already drawn and never goes negative", () => {
    expect(availableAdvance(facts({ alreadyDrawn: 12_000_00 }), P)).toBe(8_000_00);
    expect(availableAdvance(facts({ alreadyDrawn: 99_000_00 }), P)).toBe(0);
  });
  it("cannot exceed what the month's pay will be after fixed deductions", () => {
    const f = facts({
      netMonthly: 10_000_00,
      otherDeductionsDue: 8_000_00,
      earnedSoFar: 40_000_00,
    });
    expect(availableAdvance(f, P)).toBe(2_000_00);
  });
  it("auto-approves small requests and routes large ones to a person", () => {
    expect(decideRequest(5_000_00, facts(), P)).toEqual({ ok: true, outcome: "auto_approved" });
    expect(decideRequest(5_100_00, facts(), P)).toEqual({ ok: true, outcome: "needs_approval" });
  });
  it("rejects too small, too large, fractional and over-limit counts", () => {
    expect(decideRequest(100_00, facts(), P).ok).toBe(false);
    expect(decideRequest(20_100_00, facts(), P)).toMatchObject({ ok: false });
    expect(decideRequest(1_000_50, facts(), P)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/whole/),
    });
    expect(decideRequest(1_000_00, facts({ requestsThisMonth: 3 }), P)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/3 requests/),
    });
  });
  it("pro-rates by days elapsed minus unpaid days", () => {
    expect(earnedShare(15, 30, 0)).toBe(0.5);
    expect(earnedShare(15, 30, 5)).toBeCloseTo(1 / 3);
    expect(earnedShare(40, 30, 0)).toBe(1);
    expect(earnedShare(3, 30, 9)).toBe(0);
  });
});
