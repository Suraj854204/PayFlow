import { describe, expect, it } from "vitest";
import { currentStreak, type DayRecord } from "./streak";
import { computeBadges } from "../engagement/badges";
import { responseSentiment, scoreText } from "../surveys/sentiment";
import { MIN_RESPONSES, summarise, type ResponseRow } from "../surveys/results";

const day = (d: string, status: DayRecord["status"]): DayRecord => ({ date: d, status });

describe("attendance streak", () => {
  it("counts consecutive present days and skips days off", () => {
    const r = [
      day("2026-11-02", "present"),
      day("2026-11-03", "present"),
      day("2026-11-04", "present"),
    ];
    expect(currentStreak(r, "2026-11-04").days).toBe(3);
    const withWeekend = [
      day("2026-10-30", "present"),
      day("2026-10-31", "weekly_off"),
      day("2026-11-01", "weekly_off"),
      day("2026-11-02", "present"),
    ];
    expect(currentStreak(withWeekend, "2026-11-02").days).toBe(2);
    const holiday = [
      day("2026-10-30", "present"),
      day("2026-10-31", "holiday"),
      day("2026-11-02", "leave"),
      day("2026-11-03", "present"),
    ];
    const sunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
    expect(currentStreak(holiday, "2026-11-03", sunday).days).toBe(2);
    expect(currentStreak(holiday, "2026-11-03").days).toBe(1);
  });
  it("an absence or half day resets it, and today not yet checked in does not", () => {
    const r = [
      day("2026-11-02", "present"),
      day("2026-11-03", "absent"),
      day("2026-11-04", "present"),
    ];
    expect(currentStreak(r, "2026-11-04")).toEqual({ days: 1, best: 1 });
    const pending = [day("2026-11-02", "present"), day("2026-11-03", "present")];
    expect(currentStreak(pending, "2026-11-04").days).toBe(2);
    expect(
      currentStreak([day("2026-11-02", "present"), day("2026-11-03", "half_day")], "2026-11-03")
        .days,
    ).toBe(0);
  });
  it("a missing past working day breaks the streak and best is remembered", () => {
    const r = [
      day("2026-10-26", "present"),
      day("2026-10-27", "present"),
      day("2026-10-28", "present"),
      day("2026-10-30", "present"),
    ];
    expect(currentStreak(r, "2026-10-30")).toEqual({ days: 1, best: 3 });
  });
});

describe("badges", () => {
  const facts = {
    streakDays: 3,
    bestStreak: 8,
    completedMonths: [{ month: "2026-09", absences: 0, lateDays: 0, workingDays: 21 }],
    onTimeCheckInsLast30: 10,
    recognitionsGiven: 5,
    recognitionsReceived: 1,
    tenureMonths: 14,
  };
  it("awards what the facts support and shows progress for the rest", () => {
    const b = Object.fromEntries(computeBadges(facts).map((x) => [x.key, x]));
    expect(b.streak7.earned).toBe(true);
    expect(b.streak30.earned).toBe(false);
    expect(b.streak30.progress).toBeCloseTo(8 / 30);
    expect(b.perfect.earned).toBe(true);
    expect(b.early.progress).toBe(0.5);
    expect(b.giver.earned).toBe(true);
    expect(b.loved.earned).toBe(false);
    expect(b.year1.earned).toBe(true);
    expect(b.year3.earned).toBe(false);
  });
  it("a short month with a late day does not count as perfect", () => {
    const b = computeBadges({
      ...facts,
      completedMonths: [
        { month: "2026-09", absences: 0, lateDays: 1, workingDays: 21 },
        { month: "2026-08", absences: 0, lateDays: 0, workingDays: 5 },
      ],
    });
    expect(b.find((x) => x.key === "perfect")!.earned).toBe(false);
  });
});

describe("sentiment", () => {
  it("reads positive, negative and neutral text", () => {
    expect(scoreText("I love my team, very supportive and helpful").sentiment).toBe("positive");
    expect(scoreText("Constant pressure, I feel burnt out and stressed").sentiment).toBe(
      "negative",
    );
    expect(scoreText("The cafeteria opens at nine").sentiment).toBe("neutral");
  });
  it("handles negation and emphasis", () => {
    expect(scoreText("I am not happy").sentiment).toBe("negative");
    expect(scoreText("not stressed at all").sentiment).toBe("positive");
    expect(scoreText("very stressed").score).toBeLessThan(scoreText("stressed").score);
  });
  it("understands common Hindi words in Roman letters", () => {
    expect(scoreText("kaam achha hai, mast team").sentiment).toBe("positive");
    expect(scoreText("bahut tension aur thaka hua").sentiment).toBe("negative");
  });
  it("combines scale answers with the comment", () => {
    expect(responseSentiment([5, 5, 4], "").sentiment).toBe("positive");
    expect(responseSentiment([1, 2, 1], "").sentiment).toBe("negative");
    expect(responseSentiment([3, 3, 3], "").sentiment).toBe("neutral");
    expect(responseSentiment([4, 4], "so stressed and tired").sentiment).not.toBe("positive");
  });
});

describe("survey results privacy", () => {
  const qs = [
    { id: "q1", text: "Happy?", kind: "scale" as const },
    { id: "q2", text: "Anything else?", kind: "text" as const },
  ];
  const row = (dept: string | null, v: number, c = ""): ResponseRow => ({
    departmentId: dept,
    answers: { q1: v, q2: c },
    sentiment: v >= 4 ? "positive" : v <= 2 ? "negative" : "neutral",
  });
  it("shows nothing below the minimum number of responses", () => {
    const r = summarise(
      qs,
      Array.from({ length: MIN_RESPONSES - 1 }, () => row("d1", 5)),
    );
    expect(r).toEqual({ visible: false, responses: MIN_RESPONSES - 1, needed: MIN_RESPONSES });
  });
  it("aggregates once enough people answered, and hides small departments", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row("big", 4, "good")),
      row("small", 1, "bad"),
      row("small", 2),
    ];
    const r = summarise(qs, rows);
    if (!r.visible) throw new Error("expected visible");
    expect(r.responses).toBe(7);
    expect(r.questions[0].distribution).toEqual([1, 1, 0, 5, 0]);
    expect(r.questions[0].average).toBe(3.29);
    expect(r.departments.map((d) => d.departmentId)).toEqual(["big"]);
    expect(r.hiddenDepartments).toBe(1);
    expect(r.questions[1].comments.sort()).toEqual(
      ["bad", "good", "good", "good", "good", "good"].sort(),
    );
  });
});
