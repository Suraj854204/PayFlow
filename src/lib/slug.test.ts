import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Technologies Pvt. Ltd.")).toBe("acme-technologies-pvt-ltd");
  });
  it("strips accents and edge hyphens", () => {
    expect(slugify("  Café Résumé!! ")).toBe("cafe-resume");
  });
  it("returns empty string for non-latin only input", () => {
    expect(slugify("बैंक")).toBe("");
  });
  it("caps the length", () => {
    expect(slugify("a".repeat(100)).length).toBe(40);
  });
});
