export interface BadgeFacts {
  streakDays: number;
  bestStreak: number;
  /** Months (YYYY-MM) that have fully passed, with the counts we need. */
  completedMonths: { month: string; absences: number; lateDays: number; workingDays: number }[];
  onTimeCheckInsLast30: number;
  recognitionsGiven: number;
  recognitionsReceived: number;
  tenureMonths: number;
}

export interface Badge {
  key: string;
  title: string;
  description: string;
  earned: boolean;
  /** 0 to 1 toward earning it, for the locked ones. */
  progress: number;
}

const ratio = (n: number, of: number) => Math.max(0, Math.min(1, n / of));

/** Badges are worked out from facts each time, never stored, so they cannot drift from the records. */
export function computeBadges(f: BadgeFacts): Badge[] {
  const perfect = f.completedMonths.filter(
    (m) => m.workingDays >= 15 && m.absences === 0 && m.lateDays === 0,
  ).length;
  const defs: Omit<Badge, "earned" | "progress">[] & { goal: number; have: number }[] = [] as never;
  void defs;
  const list: { key: string; title: string; description: string; have: number; goal: number }[] = [
    {
      key: "streak7",
      title: "Week warrior",
      description: "Attend 7 working days in a row.",
      have: f.bestStreak,
      goal: 7,
    },
    {
      key: "streak30",
      title: "Iron routine",
      description: "Attend 30 working days in a row.",
      have: f.bestStreak,
      goal: 30,
    },
    {
      key: "perfect",
      title: "Perfect month",
      description: "A full month with no absences and no late arrivals.",
      have: perfect,
      goal: 1,
    },
    {
      key: "early",
      title: "Early bird",
      description: "20 on-time check-ins in the last 30 days.",
      have: f.onTimeCheckInsLast30,
      goal: 20,
    },
    {
      key: "giver",
      title: "Cheerleader",
      description: "Recognise 5 colleagues.",
      have: f.recognitionsGiven,
      goal: 5,
    },
    {
      key: "loved",
      title: "Appreciated",
      description: "Be recognised by 3 colleagues.",
      have: f.recognitionsReceived,
      goal: 3,
    },
    {
      key: "year1",
      title: "One year in",
      description: "Complete a year with the company.",
      have: f.tenureMonths,
      goal: 12,
    },
    {
      key: "year3",
      title: "Three years strong",
      description: "Complete three years with the company.",
      have: f.tenureMonths,
      goal: 36,
    },
  ];
  return list.map((b) => ({
    key: b.key,
    title: b.title,
    description: b.description,
    earned: b.have >= b.goal,
    progress: ratio(b.have, b.goal),
  }));
}
