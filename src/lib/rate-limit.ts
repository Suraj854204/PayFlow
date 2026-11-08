import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Window = `${number} ${"s" | "m" | "h"}`;

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

// In-memory fallback so local dev and CI work without Redis. Not shared across instances.
const memory = new Map<string, { count: number; resetAt: number }>();

function windowMs(w: Window): number {
  const [n, unit] = w.split(" ");
  return Number(n) * (unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}

const limiters = new Map<string, Ratelimit>();

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export async function rateLimit(
  bucket: string,
  identifier: string,
  limit = 30,
  window: Window = "1 m",
): Promise<RateLimitResult> {
  if (redis) {
    const k = `${bucket}:${limit}:${window}`;
    let rl = limiters.get(k);
    if (!rl) {
      rl = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, window),
        prefix: `pf:rl:${bucket}`,
      });
      limiters.set(k, rl);
    }
    const r = await rl.limit(identifier);
    return { success: r.success, remaining: r.remaining, resetAt: r.reset };
  }

  const key = `${bucket}:${identifier}`;
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs(window) });
    return { success: true, remaining: limit - 1, resetAt: now + windowMs(window) };
  }
  entry.count += 1;
  return {
    success: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}
