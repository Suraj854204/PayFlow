import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toActionError, UserFacingError } from "./action";
import { ForbiddenError } from "./rbac";
import { cn, initials } from "./utils";
import { ACCENTS, ACCENT_BOOT_SCRIPT, ACCENT_KEY, isAccent } from "./accent";
import { TOUR_STEPS } from "./tour";
import { STEP_LABEL, STEP_ORDER } from "./pipeline/labels";

describe("toActionError", () => {
  it("passes through only messages written for people", () => {
    expect(toActionError(new UserFacingError("Month is locked."))).toEqual({
      ok: false,
      error: "Month is locked.",
    });
    expect(toActionError(new ForbiddenError("payroll:approve" as never)).error).toMatch(
      /permission/,
    );
  });
  it("never leaks internals of unexpected errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = toActionError(
      new Error('duplicate key value violates unique constraint "secret_idx" (pan=ABCDE1234F)'),
    );
    expect(r.error).toBe("Something went wrong. Please try again.");
    expect(JSON.stringify(r)).not.toMatch(/secret_idx|ABCDE1234F/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("turns validation errors into field messages", () => {
    const bad = z.object({ name: z.string().min(3) }).safeParse({ name: "x" });
    const r = toActionError((bad as { error: z.ZodError }).error);
    expect(r.fieldErrors?.name?.length).toBe(1);
  });
  it("asks for sign-in on auth errors", () => {
    const e = new Error("nope");
    e.name = "UnauthorizedError";
    expect(toActionError(e).error).toMatch(/sign in/i);
  });
});

describe("small helpers", () => {
  it("merges class names", () => expect(cn("p-2", false, "p-4")).toBe("p-4"));
  it("builds initials", () => {
    expect(initials("Asha Kapoor")).toBe("AK");
    expect(initials("  single ")).toBe("S");
    expect(initials("a b c")).toBe("AB");
    expect(initials("")).toBe("");
  });
  it("knows its accents", () => {
    expect(isAccent("teal")).toBe(true);
    expect(isAccent("</script>")).toBe(false);
    expect(ACCENTS).toHaveLength(5);
    // The boot script is inlined into every page, so it must not carry anything unescaped.
    expect(ACCENT_BOOT_SCRIPT).toContain(ACCENT_KEY);
    expect(ACCENT_BOOT_SCRIPT).not.toContain("</script");
  });
  it("tour and pipeline labels are complete", () => {
    for (const s of TOUR_STEPS) expect(s.title && s.body && s.target).toBeTruthy();
    for (const k of STEP_ORDER) expect(STEP_LABEL[k]).toBeTruthy();
    expect(new Set(STEP_ORDER).size).toBe(STEP_ORDER.length);
  });
});
