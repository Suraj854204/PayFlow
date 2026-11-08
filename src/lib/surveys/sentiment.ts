export type Sentiment = "positive" | "neutral" | "negative";

const POSITIVE = new Set(
  "good great excellent happy love loved like enjoy enjoying supportive helpful clear fair balanced motivated proud grateful thankful appreciate appreciated amazing better best comfortable respectful flexible friendly growth learning collaborative trust trusted recognised recognized wonderful fantastic satisfied positive improving improved easy achha accha badhiya mast khush shukriya".split(
    " ",
  ),
);
const NEGATIVE = new Set(
  "bad poor terrible hate hated unhappy stress stressed stressful burnout burnt overworked overload overloaded unfair toxic unclear confusing ignored underpaid underappreciated worried anxious tired exhausted frustrated frustrating angry difficult hard slow chaos chaotic micromanaged micromanagement pressure demotivated disappointed negative worse worst lonely isolated bura kharab thaka pareshan tension".split(
    " ",
  ),
);
const NEGATORS = new Set([
  "not",
  "no",
  "never",
  "without",
  "nahi",
  "nahin",
  "hardly",
  "cannot",
  "cant",
  "isnt",
  "dont",
  "doesnt",
  "wasnt",
  "arent",
  "didnt",
]);
const BOOSTERS = new Set(["very", "really", "extremely", "too", "so", "bahut", "totally"]);

/**
 * A small, readable word-list scorer with negation ("not happy") and emphasis ("very stressed"). It
 * reads English and common Hindi words written in Roman letters. It is deliberately simple and
 * transparent, so it will miss sarcasm and nuance: treat it as a rough signal over many answers.
 */
export function scoreText(text: string): { score: number; sentiment: Sentiment } {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  let score = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let v = POSITIVE.has(w) ? 1 : NEGATIVE.has(w) ? -1 : 0;
    if (v === 0) continue;
    const before = words.slice(Math.max(0, i - 3), i);
    if (before.some((b) => NEGATORS.has(b))) v = -v;
    if (before.some((b) => BOOSTERS.has(b))) v *= 1.5;
    score += v;
  }
  return {
    score: Math.round(score * 10) / 10,
    sentiment: score >= 1 ? "positive" : score <= -1 ? "negative" : "neutral",
  };
}

/** Combines the 1 to 5 answers with the written comment into one label per response. */
export function responseSentiment(
  scales: number[],
  comment: string,
): { sentiment: Sentiment; score: number } {
  const avg = scales.length ? scales.reduce((s, n) => s + n, 0) / scales.length : 3;
  const scaleScore = (avg - 3) * 1.5; // 1 -> -3, 3 -> 0, 5 -> +3
  const text = comment.trim() ? scoreText(comment).score : 0;
  const total = Math.round((scaleScore + text) * 10) / 10;
  return {
    score: Math.round(total * 10),
    sentiment: total >= 1 ? "positive" : total <= -1 ? "negative" : "neutral",
  };
}
