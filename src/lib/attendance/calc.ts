export interface GeoPoint {
  lat: number;
  lng: number;
}
export interface Geofence extends GeoPoint {
  radiusM: number;
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** null when no fence is configured or no location was sent (so the caller can decide). */
export function insideGeofence(point: GeoPoint | null, fence: Geofence | null): boolean | null {
  if (!fence || !point) return null;
  return haversineMeters(point, fence) <= fence.radiusM;
}

export function isValidPoint(p: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateInTz(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return parts; // en-CA yields YYYY-MM-DD
}

/** Minutes since local midnight of an instant in a time zone. */
export function minutesOfDayInTz(at: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const h = Number(f.find((p) => p.type === "hour")!.value) % 24;
  const m = Number(f.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

export interface ShiftDef {
  start: string; // HH:MM or HH:MM:SS
  end: string;
  graceMinutes: number;
}
export const DEFAULT_SHIFT: ShiftDef = { start: "09:30", end: "18:30", graceMinutes: 10 };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Scheduled minutes for a shift; overnight shifts wrap past midnight. */
export function scheduledMinutes(s: ShiftDef): number {
  const d = toMin(s.end) - toMin(s.start);
  return d > 0 ? d : d + 24 * 60;
}

export const OVERTIME_THRESHOLD_MIN = 30;
export const OVERTIME_DAILY_CAP_MIN = 240;

export interface DayResult {
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  status: "present" | "half_day" | "absent";
}

/**
 * Turns a check-in/out pair into the day's figures. Present needs 75% of the scheduled time, half a
 * day needs 40%. Overtime is time beyond the shift, only once it passes 30 minutes, capped at 4 hours
 * a day. A day still missing its check-out counts as present with no worked time until it is fixed.
 */
export function computeDay(
  checkIn: Date,
  checkOut: Date | null,
  shift: ShiftDef,
  tz: string,
): DayResult {
  const lateRaw = minutesOfDayInTz(checkIn, tz) - toMin(shift.start);
  const lateMinutes = Math.max(0, lateRaw > shift.graceMinutes ? lateRaw : 0);
  if (!checkOut) return { workedMinutes: 0, lateMinutes, overtimeMinutes: 0, status: "present" };
  const worked = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000));
  const sched = scheduledMinutes(shift);
  const extra = worked - sched;
  const overtimeMinutes =
    extra >= OVERTIME_THRESHOLD_MIN ? Math.min(extra, OVERTIME_DAILY_CAP_MIN) : 0;
  const status = worked >= sched * 0.75 ? "present" : worked >= sched * 0.4 ? "half_day" : "absent";
  return { workedMinutes: worked, lateMinutes, overtimeMinutes, status };
}
