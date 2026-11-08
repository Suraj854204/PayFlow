import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditLogs } from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { computeAuditHash, GENESIS_HASH } from "@/lib/audit-chain";

export interface AuditInput {
  organizationId: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  ip?: string | null;
}

/**
 * Appends a hash-chained audit entry inside the caller's transaction, so the business change and
 * its audit record commit or roll back together. An advisory lock serializes writers per org so
 * sequence numbers never collide.
 */
export async function writeAudit(tx: Tx, input: AuditInput) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}))`);

  const [last] = await tx
    .select({ seq: auditLogs.seq, hash: auditLogs.hash })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, input.organizationId))
    .orderBy(desc(auditLogs.seq))
    .limit(1);

  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const createdAt = new Date();
  // Hash exactly what Postgres will store. jsonb drops undefined keys and turns Dates into strings, so
  // hashing the raw object would make the chain fail verification once the row is read back.
  const plain = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const oldValues = plain(input.oldValues);
  const newValues = plain(input.newValues);
  const metadata = plain(input.metadata);

  const hash = computeAuditHash(prevHash, {
    organizationId: input.organizationId,
    seq,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    oldValues,
    newValues,
    metadata,
    createdAt: createdAt.toISOString(),
  });

  const [row] = await tx
    .insert(auditLogs)
    .values({
      organizationId: input.organizationId,
      seq,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValues,
      newValues,
      metadata,
      ip: input.ip ?? null,
      prevHash,
      hash,
      createdAt,
    })
    .returning();
  return row;
}

export async function listAudit(tx: Tx, organizationId: string, limit = 50) {
  return tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId)))
    .orderBy(desc(auditLogs.seq))
    .limit(limit);
}

export interface AuditFilter {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  actor?: string;
}

/** Filtered, newest-first audit query shared by the page and the CSV export. */
export async function queryAudit(tx: Tx, organizationId: string, f: AuditFilter, limit = 200) {
  const conds = [eq(auditLogs.organizationId, organizationId)];
  // Escape LIKE wildcards so the text matches literally (underscores are common in action names).
  if (f.action)
    conds.push(sql`${auditLogs.action} ilike ${"%" + f.action.replace(/[\\%_]/g, "\\$&") + "%"}`);
  if (f.entityType) conds.push(eq(auditLogs.entityType, f.entityType));
  if (f.actor) conds.push(eq(auditLogs.actorUserId, f.actor));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from))
    conds.push(sql`${auditLogs.createdAt} >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to))
    conds.push(sql`${auditLogs.createdAt} < (${f.to}::date + 1)`);
  return tx
    .select()
    .from(auditLogs)
    .where(and(...conds))
    .orderBy(desc(auditLogs.seq))
    .limit(limit);
}
