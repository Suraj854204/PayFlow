import type { SurveyQuestion } from "@/lib/db/schema";

/** Nothing is shown for a group smaller than this, so no answer can be pinned on a person. */
export const MIN_RESPONSES = 5;

export interface ResponseRow {
  departmentId: string | null;
  answers: Record<string, number | string>;
  sentiment: "positive" | "neutral" | "negative";
}

export interface QuestionResult {
  id: string;
  text: string;
  kind: "scale" | "text";
  average: number | null;
  distribution: number[];
  comments: string[];
}

export interface DeptResult {
  departmentId: string;
  responses: number;
  average: number | null;
  negativeShare: number;
}

export type SurveyResults =
  | { visible: false; responses: number; needed: number }
  | {
      visible: true;
      responses: number;
      sentiment: { positive: number; neutral: number; negative: number };
      overallAverage: number | null;
      questions: QuestionResult[];
      departments: {
        departmentId: string;
        responses: number;
        average: number | null;
        negativeShare: number;
      }[];
      hiddenDepartments: number;
    };

const shuffled = <T>(xs: T[], seed: number) => {
  const a = [...xs];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function summarise(questions: SurveyQuestion[], rows: ResponseRow[]): SurveyResults {
  if (rows.length < MIN_RESPONSES)
    return { visible: false, responses: rows.length, needed: MIN_RESPONSES };
  const scaleIds = questions.filter((q) => q.kind === "scale").map((q) => q.id);
  const avgOf = (rs: ResponseRow[]) => {
    const vals = rs.flatMap((r) =>
      scaleIds.map((id) => r.answers[id]).filter((v): v is number => typeof v === "number"),
    );
    return vals.length
      ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100
      : null;
  };
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const r of rows) sentiment[r.sentiment]++;

  const qs: QuestionResult[] = questions.map((q) => {
    const vals = rows.map((r) => r.answers[q.id]);
    if (q.kind === "scale") {
      const nums = vals.filter((v): v is number => typeof v === "number");
      const dist = [1, 2, 3, 4, 5].map((n) => nums.filter((v) => v === n).length);
      return {
        id: q.id,
        text: q.text,
        kind: q.kind,
        average: nums.length
          ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100
          : null,
        distribution: dist,
        comments: [],
      };
    }
    const comments = vals.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    // Order is shuffled so position in the list says nothing about who wrote it.
    return {
      id: q.id,
      text: q.text,
      kind: q.kind,
      average: null,
      distribution: [],
      comments: shuffled(comments, comments.length * 7919),
    };
  });

  const byDept = new Map<string, ResponseRow[]>();
  for (const r of rows)
    if (r.departmentId) byDept.set(r.departmentId, [...(byDept.get(r.departmentId) ?? []), r]);
  const departments: DeptResult[] = [];
  let hidden = 0;
  for (const [departmentId, rs] of byDept) {
    if (rs.length < MIN_RESPONSES) {
      hidden++;
      continue;
    }
    departments.push({
      departmentId,
      responses: rs.length,
      average: avgOf(rs),
      negativeShare:
        Math.round((rs.filter((r) => r.sentiment === "negative").length / rs.length) * 100) / 100,
    });
  }
  return {
    visible: true,
    responses: rows.length,
    sentiment,
    overallAverage: avgOf(rows),
    questions: qs,
    departments,
    hiddenDepartments: hidden,
  };
}
