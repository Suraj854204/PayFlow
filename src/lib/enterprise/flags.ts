/** Switches a company admin can flip. A missing row means the default below. */
export const FLAG_DEFS = [
  {
    key: "ewa",
    label: "Earned wage access",
    description: "Let employees request an advance on pay they have already earned.",
    defaultOn: true,
  },
  {
    key: "recognition",
    label: "Recognition and badges",
    description: "Peer recognition, streaks and badges.",
    defaultOn: true,
  },
  {
    key: "surveys",
    label: "Pulse surveys",
    description: "Anonymous surveys with aggregate results.",
    defaultOn: true,
  },
  {
    key: "equity",
    label: "Pay equity report",
    description: "Show the pay gap analysis to people who can read salaries.",
    defaultOn: true,
  },
  {
    key: "paybot",
    label: "PayBot assistant",
    description: "The AI assistant that answers payroll and policy questions.",
    defaultOn: true,
  },
] as const;

export type FlagKey = (typeof FLAG_DEFS)[number]["key"];

export function resolveFlags(rows: { key: string; enabled: boolean }[]): Record<FlagKey, boolean> {
  const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
  return Object.fromEntries(
    FLAG_DEFS.map((d) => [d.key, byKey.get(d.key) ?? d.defaultOn]),
  ) as Record<FlagKey, boolean>;
}

export const isFlagKey = (k: string): k is FlagKey => FLAG_DEFS.some((d) => d.key === k);
