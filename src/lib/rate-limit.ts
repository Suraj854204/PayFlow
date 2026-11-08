import "server-only";

type Window = `${number} ${"s" | "m" | "h"}`;

// In-memory counters: per process, not shared across instances. Fine for one server or Docker container.
const memory = new Map<string, { count: number; resetAt: number }>();

function windowMs(w: Window): number {
  const [n, unit] = w.split(" ");
  return Number(n) * (unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}

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
