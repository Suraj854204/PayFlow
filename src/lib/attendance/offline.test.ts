import { describe, expect, it } from "vitest";
import { resolvePunchTime } from "./offline";

const NOW = Date.parse("2026-11-04T10:00:00Z");
describe("resolvePunchTime", () => {
  it("uses server time when no time is sent", () => {
    const r = resolvePunchTime(undefined, NOW);
    expect(r).toMatchObject({ ok: true, offline: false });
  });
  it("accepts a recent offline punch", () => {
    const r = resolvePunchTime("2026-11-04T04:00:00Z", NOW);
    expect(r).toMatchObject({ ok: true, offline: true });
    if (r.ok) expect(r.when.toISOString()).toBe("2026-11-04T04:00:00.000Z");
  });
  it("tolerates small clock skew and clamps to now", () => {
    const r = resolvePunchTime("2026-11-04T10:01:00Z", NOW);
    expect(r.ok && r.when.getTime()).toBe(NOW);
  });
  it("rejects future, stale and garbage", () => {
    expect(resolvePunchTime("2026-11-04T11:00:00Z", NOW).ok).toBe(false);
    expect(resolvePunchTime("2026-11-02T09:00:00Z", NOW).ok).toBe(false);
    expect(resolvePunchTime("nope", NOW).ok).toBe(false);
    expect(resolvePunchTime(5, NOW).ok).toBe(false);
  });
});
