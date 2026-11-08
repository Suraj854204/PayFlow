import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import { NAV_ITEMS } from "@/lib/nav";

const keys = (o: Record<string, unknown>, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
  );

describe("message catalogues", () => {
  it("Hindi has exactly the English keys", () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });
  it("no Hindi value is empty", () => {
    for (const k of keys(hi)) {
      const v = k.split(".").reduce<unknown>((a, x) => (a as Record<string, unknown>)[x], hi);
      expect(String(v).trim().length, k).toBeGreaterThan(0);
    }
  });
  it("every navigation label and group is translated", () => {
    const nav = hi.nav as Record<string, string>;
    for (const i of NAV_ITEMS) expect(nav[i.label], i.label).toBeTruthy();
    expect(nav.Workspace && nav.Admin).toBeTruthy();
  });
});
