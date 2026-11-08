import { describe, expect, it } from "vitest";
import {
  canonicalize,
  computeAuditHash,
  GENESIS_HASH,
  verifyChain,
  type AuditPayload,
  type ChainRow,
} from "./audit-chain";

function build(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const payload: AuditPayload = {
      organizationId: "org-1",
      seq,
      actorUserId: "u1",
      actorRole: "hr_admin",
      action: `thing.${seq}`,
      entityType: "thing",
      entityId: String(seq),
      oldValues: { a: seq - 1 },
      newValues: { a: seq },
      metadata: null,
      createdAt: new Date(2026, 0, seq).toISOString(),
    };
    const hash = computeAuditHash(prev, payload);
    rows.push({ ...payload, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

describe("audit hash chain", () => {
  it("canonicalize ignores key order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(canonicalize([1, { b: 1, a: 2 }])).toBe('[1,{"a":2,"b":1}]');
    expect(canonicalize(undefined)).toBe("null");
  });

  it("accepts an untouched chain and an empty chain", () => {
    expect(verifyChain(build(5))).toEqual({ valid: true });
    expect(verifyChain([])).toEqual({ valid: true });
  });

  it("detects a modified entry", () => {
    const rows = build(4);
    rows[2] = { ...rows[2], newValues: { a: 999 } };
    expect(verifyChain(rows)).toMatchObject({
      valid: false,
      brokenAtSeq: 3,
      reason: "Entry contents were modified",
    });
  });

  it("detects a deleted entry", () => {
    const rows = build(4);
    rows.splice(1, 1);
    expect(verifyChain(rows)).toMatchObject({ valid: false, brokenAtSeq: 3 });
  });

  it("detects reordered entries", () => {
    const rows = build(4);
    [rows[1], rows[2]] = [rows[2], rows[1]];
    expect(verifyChain(rows).valid).toBe(false);
  });

  it("detects a rewritten link even when the row hash is recomputed", () => {
    const rows = build(3);
    const forgedPrev = "f".repeat(64);
    const { prevHash: _p, hash: _h, ...payload } = rows[1];
    void _p;
    void _h;
    rows[1] = { ...payload, prevHash: forgedPrev, hash: computeAuditHash(forgedPrev, payload) };
    expect(verifyChain(rows)).toMatchObject({
      valid: false,
      brokenAtSeq: 2,
      reason: "prevHash does not match previous entry",
    });
  });

  it("requires the first entry to reference genesis", () => {
    const rows = build(2);
    const { prevHash: _p, hash: _h, ...payload } = rows[0];
    void _p;
    void _h;
    rows[0] = {
      ...payload,
      prevHash: "a".repeat(64),
      hash: computeAuditHash("a".repeat(64), payload),
    };
    expect(verifyChain(rows)).toMatchObject({ valid: false, brokenAtSeq: 1 });
  });
});
