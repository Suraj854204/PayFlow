export const MAX_OFFLINE_AGE_MS = 48 * 3600_000;
export const MAX_CLOCK_SKEW_MS = 2 * 60_000;

export type PunchTime = { ok: true; when: Date; offline: boolean } | { ok: false; error: string };

/**
 * A punch made while offline is sent later with the time it happened. The server accepts that time
 * only if it is not in the future (beyond clock skew) and not older than 48 hours; anything else is
 * refused so a device clock cannot be used to backdate attendance.
 */
export function resolvePunchTime(at: unknown, nowMs: number): PunchTime {
  if (at === undefined || at === null) return { ok: true, when: new Date(nowMs), offline: false };
  if (typeof at !== "string") return { ok: false, error: "Invalid punch time." };
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return { ok: false, error: "Invalid punch time." };
  if (t > nowMs + MAX_CLOCK_SKEW_MS)
    return { ok: false, error: "This punch is dated in the future, so it was rejected." };
  if (t < nowMs - MAX_OFFLINE_AGE_MS)
    return { ok: false, error: "This punch is more than 48 hours old. Ask HR to correct it." };
  return { ok: true, when: new Date(Math.min(t, nowMs)), offline: true };
}
