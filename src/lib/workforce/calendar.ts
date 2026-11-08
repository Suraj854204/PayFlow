import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { holidays, organizations } from "@/lib/db/schema";
import type { Geofence } from "@/lib/attendance/calc";

export interface OrgCalendar {
  weeklyOffs: number[];
  holidays: Set<string>;
  tz: string;
  fence: Geofence | null;
}

/** Company calendar settings plus the (non-optional) holidays between two dates. */
export async function loadCalendar(
  tx: Tx,
  organizationId: string,
  from: string,
  to: string,
): Promise<OrgCalendar> {
  const [org] = await tx
    .select({
      weeklyOffs: organizations.weeklyOffs,
      tz: organizations.timezone,
      lat: organizations.geofenceLat,
      lng: organizations.geofenceLng,
      radius: organizations.geofenceRadiusM,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const hs = await tx
    .select({ date: holidays.date })
    .from(holidays)
    .where(
      and(
        eq(holidays.organizationId, organizationId),
        eq(holidays.isOptional, false),
        isNull(holidays.deletedAt),
        gte(holidays.date, from),
        lte(holidays.date, to),
      ),
    );
  return {
    weeklyOffs: org?.weeklyOffs ?? [0],
    holidays: new Set(hs.map((h) => h.date)),
    tz: org?.tz ?? "Asia/Kolkata",
    fence:
      org && org.lat != null && org.lng != null && org.radius
        ? { lat: org.lat, lng: org.lng, radiusM: org.radius }
        : null,
  };
}
