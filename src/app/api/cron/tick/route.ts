import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tick } from "@/lib/workflow/dispatch";
import { runPipelineSweep } from "@/lib/pipeline/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Self-hosted alternative to Inngest's cron: point any scheduler at this with the CRON_SECRET. */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const a = await tick();
  const b = await runPipelineSweep();
  return NextResponse.json({ ok: true, ...a, ...b });
}
