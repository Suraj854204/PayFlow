import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditPayload {
  organizationId: string;
  seq: number;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: unknown;
  newValues: unknown;
  metadata: unknown;
  createdAt: string; // ISO string
}

/** Stable JSON: object keys sorted recursively so the hash does not depend on key order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",")}}`;
}

export function computeAuditHash(prevHash: string, payload: AuditPayload): string {
  return createHash("sha256")
    .update(prevHash)
    .update("|")
    .update(canonicalize(payload))
    .digest("hex");
}

export interface ChainRow extends AuditPayload {
  prevHash: string;
  hash: string;
}

export type ChainVerification =
  { valid: true } | { valid: false; brokenAtSeq: number; reason: string };

/** Verifies an ordered (ascending seq) list of audit rows for one organization. */
export function verifyChain(rows: ChainRow[]): ChainVerification {
  let previous: ChainRow | null = null;
  for (const row of rows) {
    if (previous === null) {
      if (row.seq === 1 && row.prevHash !== GENESIS_HASH) {
        return { valid: false, brokenAtSeq: row.seq, reason: "First entry must reference genesis" };
      }
    } else {
      if (row.seq !== previous.seq + 1) {
        return { valid: false, brokenAtSeq: row.seq, reason: "Sequence gap or reorder detected" };
      }
      if (row.prevHash !== previous.hash) {
        return {
          valid: false,
          brokenAtSeq: row.seq,
          reason: "prevHash does not match previous entry",
        };
      }
    }
    const { prevHash, hash, ...payload } = row;
    if (computeAuditHash(prevHash, payload) !== hash) {
      return { valid: false, brokenAtSeq: row.seq, reason: "Entry contents were modified" };
    }
    previous = row;
  }
  return { valid: true };
}
