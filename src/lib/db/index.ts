import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool as PgPool } from "pg";
import ws from "ws";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { pf_db?: Db };

/**
 * Neon hosts use the serverless WebSocket driver (works on Vercel/edge-style runtimes). Any other
 * Postgres (local, Docker, RDS) uses the standard node-postgres driver. Both expose the same
 * Drizzle API, so the rest of the app does not care which one it got.
 */
function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const isNeon = /\.neon\.tech|\.neon\.build/i.test(new URL(url).hostname);
  if (isNeon) {
    // Always use `ws`: Node 22's built-in WebSocket hides the real error (a bare ErrorEvent) and
    // is less reliable with this driver.
    neonConfig.webSocketConstructor = ws;
    return drizzleNeon(new NeonPool({ connectionString: url }), { schema }) as unknown as Db;
  }
  return drizzlePg(new PgPool({ connectionString: url, max: 10 }), { schema });
}

// Created lazily so importing this module (e.g. during `next build`) never needs a database.
export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    const instance = (globalForDb.pf_db ??= createDb());
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type Database = Db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction with the tenant set for Postgres row-level security.
 * Every policy in drizzle/rls.sql compares organization_id with `app.current_org`, so even a
 * query that forgets its WHERE clause cannot read or write another company's rows.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(organizationId)) throw new Error("Invalid organization id");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org', ${organizationId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` with the verified signed-in user set for RLS, so they can list their own memberships
 * and companies before choosing a tenant. Read-only helper: writes still require withTenant().
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
    return fn(tx);
  });
}

export { schema };
