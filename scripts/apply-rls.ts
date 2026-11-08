import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = readFileSync(join(process.cwd(), "drizzle", "rls.sql"), "utf8");
  // Same rule as src/lib/db: Neon hosts use the WebSocket driver, anything else plain node-postgres.
  const isNeon = /\.neon\.tech|\.neon\.build/i.test(new URL(url).hostname);
  const pool: { query(text: string): Promise<unknown>; end(): Promise<void> } = isNeon
    ? new NeonPool({ connectionString: url })
    : new PgPool({ connectionString: url });
  try {
    await pool.query(sql);
    console.log("Row-level security policies applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
