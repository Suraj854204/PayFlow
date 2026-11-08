export interface AttritionFacts {
  id: string;
  name: string;
  /** Key to group peers for pay comparison, e.g. the designation id. Null = no peer group. */
  peerGroup: string | null;
  departmentId: string | null;
  joinDate: string;
  ctcAnnual: number;
  /** Effective date of the latest salary revision (or the join date if never revised). */
  lastRevisionDate: string;
  absentDaysLast90: number;
  absentDaysPrev90: number;
  overtimeMinutesLast90: number;
}

export interface DeptMood {
  responses: number;
  negativeShare: number;
}

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface RiskResult {
  id: string;
  name: string;
  score: number;
  band: "low" | "medium" | "high";
  factors: RiskFactor[];
}

const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
};

export const MIN_PEERS = 3;
export const MIN_MOOD_RESPONSES = 5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A transparent, rule-based risk score, not a trained model: every point comes from a named factor
 * the reader can see and challenge. It is meant to start a supportive conversation (a stay interview,
 * a pay review), never to decide anything about a person.
 */
export function scoreAttrition(
  people: AttritionFacts[],
  today: string,
  moodByDept: Map<string, DeptMood> = new Map(),
): RiskResult[] {
  const peers = new Map<string, number[]>();
  for (const p of people)
    if (p.peerGroup) peers.set(p.peerGroup, [...(peers.get(p.peerGroup) ?? []), p.ctcAnnual]);

  return people.map((p) => {
    const factors: RiskFactor[] = [];
    const add = (key: string, label: string, points: number, detail: string) =>
      points > 0 && factors.push({ key, label, points, detail });

    const tenure = monthsBetween(p.joinDate, today);
    if (tenure >= 12 && tenure <= 30)
      add(
        "tenure",
        "In the 1 to 2.5 year window",
        20,
        `${tenure} months with the company, when people most often move on.`,
      );
    else if (tenure < 6)
      add("tenure", "Recently joined", 10, `Only ${tenure} month(s) in. Early support matters.`);

    const sinceRaise = monthsBetween(p.lastRevisionDate, today);
    if (sinceRaise >= 18)
      add(
        "raise",
        "No pay revision for a long time",
        25,
        `${sinceRaise} months since the last revision.`,
      );
    else if (sinceRaise >= 12)
      add("raise", "Pay revision is due", 12, `${sinceRaise} months since the last revision.`);

    const group = p.peerGroup ? peers.get(p.peerGroup) : undefined;
    if (group && group.length >= MIN_PEERS) {
      const ratio = p.ctcAnnual / median(group);
      if (ratio < 0.85)
        add(
          "pay",
          "Paid well below peers in the same role",
          25,
          `${Math.round(ratio * 100)}% of the peer median.`,
        );
      else if (ratio < 0.95)
        add(
          "pay",
          "Paid a little below peers",
          12,
          `${Math.round(ratio * 100)}% of the peer median.`,
        );
    }

    if (p.absentDaysLast90 - p.absentDaysPrev90 >= 3)
      add(
        "absence",
        "Absences are rising",
        15,
        `${p.absentDaysLast90} unplanned absences in 90 days, up from ${p.absentDaysPrev90}.`,
      );

    const otHours = p.overtimeMinutesLast90 / 60;
    if (otHours > 60)
      add("overtime", "Heavy overtime", 10, `${Math.round(otHours)} overtime hours in 90 days.`);

    const mood = p.departmentId ? moodByDept.get(p.departmentId) : undefined;
    if (mood && mood.responses >= MIN_MOOD_RESPONSES && mood.negativeShare >= 0.4)
      add(
        "mood",
        "Team sentiment is low",
        15,
        `${Math.round(mood.negativeShare * 100)}% of recent pulse answers in the team were negative.`,
      );

    const score = Math.min(
      100,
      factors.reduce((s, f) => s + f.points, 0),
    );
    return {
      id: p.id,
      name: p.name,
      score,
      band: score >= 55 ? "high" : score >= 30 ? "medium" : "low",
      factors: factors.sort((a, b) => b.points - a.points),
    };
  });
}
