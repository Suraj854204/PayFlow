import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, withTenant } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { hashKey } from "./keys";
import type { ApiScope } from "./scopes";

export interface ApiCaller {
  orgId: string;
  keyId: string;
  headers: Record<string, string>;
}

export function apiError(status: number, code: string, message: string, headers: HeadersInit = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/**
 * Bearer-key auth for /api/v1. The key is hashed and looked up through a security-definer function
 * (it has to work before we know the company); after that every query runs tenant-scoped.
 */
export async function authenticate(
  req: Request,
  scope: ApiScope,
): Promise<ApiCaller | NextResponse> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!/^pf_live_[0-9a-f]{48}$/.test(key))
    return apiError(401, "invalid_key", "Send your key as 'Authorization: Bearer pf_live_…'.");
  const rows = (await db.execute(sql`select * from resolve_api_key(${hashKey(key)})`)).rows as {
    key_id: string;
    organization_id: string;
    scopes: string[];
    rate_limit_per_min: number;
  }[];
  const row = rows[0];
  if (!row)
    return apiError(401, "invalid_key", "That key is not valid, has expired, or was revoked.");

  const rl = await rateLimit("api", row.key_id, row.rate_limit_per_min, "1 m");
  const headers = {
    "x-ratelimit-limit": String(row.rate_limit_per_min),
    "x-ratelimit-remaining": String(rl.remaining),
    "x-ratelimit-reset": String(Math.ceil(rl.resetAt / 1000)),
  };
  if (!rl.success)
    return apiError(429, "rate_limited", "Too many requests. Slow down and retry shortly.", {
      ...headers,
      "retry-after": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
    });
  if (!row.scopes.includes(scope))
    return apiError(
      403,
      "missing_scope",
      `This key does not have the '${scope}' permission.`,
      headers,
    );

  // Record use at most once a minute so reads do not become writes.
  void withTenant(row.organization_id, (tx) =>
    tx
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, row.key_id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(Date.now() - 60_000))),
        ),
      ),
  ).catch(() => {});
  return { orgId: row.organization_id, keyId: row.key_id, headers };
}

export const isResponse = (x: ApiCaller | NextResponse): x is NextResponse =>
  x instanceof NextResponse;

/** `?limit` (1-100, default 25) and `?page` (from 1). */
export function paging(url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return { limit, page, offset: (page - 1) * limit };
}

export function ok<T>(caller: ApiCaller, data: T, meta?: Record<string, unknown>) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { headers: caller.headers });
}
