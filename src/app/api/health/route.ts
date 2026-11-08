import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: "up" | "down" = "up";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "down";
  }
  const ok = database === "up";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      database,
      uptime: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
