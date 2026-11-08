export interface PayPerson {
  id: string;
  gender: "male" | "female" | "other" | null;
  /** Group for like-for-like comparison, e.g. "designation id". */
  role: string;
  roleLabel: string;
  ctcAnnual: number;
}

/** A gap is only reported when both groups have at least this many people, so no one is identifiable. */
export const MIN_GROUP = 3;

export interface RoleGap {
  role: string;
  label: string;
  men: number;
  women: number;
  menMedian: number;
  womenMedian: number;
  /** (men - women) / men, in percent. Positive = women paid less. */
  gapPercent: number;
}

export interface EquityReport {
  /** Everyone, ignoring role. Shows the overall picture, which role mix can explain. */
  unadjustedGapPercent: number | null;
  /** Like-for-like: average of the per-role gaps, weighted by how many people are in each role. */
  adjustedGapPercent: number | null;
  roles: RoleGap[];
  /** Roles where a gap could not be shown because a group was too small. */
  suppressedRoles: number;
  /** Share of women in each pay quartile (bottom to top). */
  womenShareByQuartile: (number | null)[];
  counts: { men: number; women: number; other: number; unknown: number };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (men: number, women: number) =>
  men === 0 ? 0 : Math.round(((men - women) / men) * 1000) / 10;

export function equityReport(people: PayPerson[]): EquityReport {
  const men = people.filter((p) => p.gender === "male");
  const women = people.filter((p) => p.gender === "female");
  const counts = {
    men: men.length,
    women: women.length,
    other: people.filter((p) => p.gender === "other").length,
    unknown: people.filter((p) => !p.gender).length,
  };
  const unadjusted =
    men.length >= MIN_GROUP && women.length >= MIN_GROUP
      ? pct(median(men.map((p) => p.ctcAnnual)), median(women.map((p) => p.ctcAnnual)))
      : null;

  const byRole = new Map<string, PayPerson[]>();
  for (const p of people) byRole.set(p.role, [...(byRole.get(p.role) ?? []), p]);
  const roles: RoleGap[] = [];
  let suppressed = 0;
  for (const [role, group] of byRole) {
    const m = group.filter((p) => p.gender === "male");
    const w = group.filter((p) => p.gender === "female");
    if (m.length === 0 || w.length === 0) continue; // nothing to compare
    if (m.length < MIN_GROUP || w.length < MIN_GROUP) {
      suppressed++;
      continue;
    }
    const mm = median(m.map((p) => p.ctcAnnual));
    const wm = median(w.map((p) => p.ctcAnnual));
    roles.push({
      role,
      label: group[0].roleLabel,
      men: m.length,
      women: w.length,
      menMedian: mm,
      womenMedian: wm,
      gapPercent: pct(mm, wm),
    });
  }
  roles.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));
  const weight = roles.reduce((s, r) => s + r.men + r.women, 0);
  const adjusted =
    weight === 0
      ? null
      : Math.round(
          (roles.reduce((s, r) => s + r.gapPercent * (r.men + r.women), 0) / weight) * 10,
        ) / 10;

  const gendered = people
    .filter((p) => p.gender === "male" || p.gender === "female")
    .sort((a, b) => a.ctcAnnual - b.ctcAnnual);
  const womenShareByQuartile: (number | null)[] = [0, 1, 2, 3].map((q) => {
    const size = gendered.length / 4;
    const slice = gendered.slice(Math.round(q * size), Math.round((q + 1) * size));
    return slice.length < MIN_GROUP
      ? null
      : Math.round((slice.filter((p) => p.gender === "female").length / slice.length) * 100);
  });
  return {
    unadjustedGapPercent: unadjusted,
    adjustedGapPercent: adjusted,
    roles,
    suppressedRoles: suppressed,
    womenShareByQuartile,
    counts,
  };
}

export interface Benchmark {
  p25: number;
  p50: number;
  p75: number;
}

/** Where one salary sits against a market range the company entered. */
export function positionInRange(
  ctc: number,
  b: Benchmark,
): { compaRatio: number; band: "below" | "within" | "above" } {
  return {
    compaRatio: Math.round((ctc / b.p50) * 100) / 100,
    band: ctc < b.p25 ? "below" : ctc > b.p75 ? "above" : "within",
  };
}
