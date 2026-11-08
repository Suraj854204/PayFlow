import { describe, expect, it } from "vitest";
import { CHUNK_TARGET, chunkPages } from "./chunk";

describe("chunkPages", () => {
  it("keeps short pages whole and remembers the page", () => {
    const c = chunkPages([
      "Leave policy.\n\nEmployees get 12 casual leaves a year.",
      "",
      "Notice period is 60 days for all grades.",
    ]);
    expect(c.map((x) => x.page)).toEqual([1, 3]);
    expect(c[0].content).toContain("12 casual leaves");
    expect(c.map((x) => x.idx)).toEqual([0, 1]);
  });
  it("splits long text into overlapping passages under the target", () => {
    const sentence = "Employees must submit expense claims within thirty days of travel. ";
    const c = chunkPages([sentence.repeat(60)]);
    expect(c.length).toBeGreaterThan(2);
    for (const x of c) expect(x.content.length).toBeLessThanOrEqual(CHUNK_TARGET * 2);
    // Overlap: the end of one passage reappears at the start of the next.
    const tail = c[0].content.slice(-40).trim().split(" ").slice(-3).join(" ");
    expect(c[1].content).toContain(tail);
  });
  it("splits one unbroken giant string and caps the total", () => {
    const c = chunkPages(["x".repeat(5000)]);
    expect(c.length).toBeGreaterThan(3);
    expect(
      chunkPages(
        Array.from({ length: 500 }, () => "A reasonably long policy paragraph. ".repeat(40)),
      ).length,
    ).toBeLessThanOrEqual(400);
  });
  it("ignores empty input", () => {
    expect(chunkPages(["", "   \n  "])).toEqual([]);
  });
});
