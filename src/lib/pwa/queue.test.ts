import { describe, expect, it } from "vitest";
import { classifyResult, drainQueue, type QueuedPunch } from "./queue";

const p = (id: string, at: string, kind: "in" | "out" = "in"): QueuedPunch => ({
  id,
  at,
  kind,
  point: null,
});

describe("offline queue", () => {
  it("classifies results", () => {
    expect(classifyResult({ ok: true })).toBe("done");
    expect(classifyResult({ ok: false, error: "You have already checked in today." })).toBe("done");
    expect(classifyResult({ ok: false, error: "You are outside the office geo-fence" })).toBe(
      "rejected",
    );
  });
  it("sends oldest first and removes each", async () => {
    const sent: string[] = [];
    const removed: string[] = [];
    const r = await drainQueue(
      [p("b", "2026-11-04T18:00:00Z", "out"), p("a", "2026-11-04T09:00:00Z")],
      async (x) => (sent.push(x.id), { ok: true }),
      async (id) => void removed.push(id),
    );
    expect(sent).toEqual(["a", "b"]);
    expect(removed).toEqual(["a", "b"]);
    expect(r).toEqual({ synced: 2, rejected: [], remaining: 0 });
  });
  it("stops and keeps the rest on a network failure", async () => {
    const removed: string[] = [];
    const r = await drainQueue(
      [p("a", "2026-11-04T09:00:00Z"), p("b", "2026-11-04T18:00:00Z", "out")],
      async (x) => {
        if (x.id === "b") throw new Error("offline");
        return { ok: true };
      },
      async (id) => void removed.push(id),
    );
    expect(removed).toEqual(["a"]);
    expect(r).toMatchObject({ synced: 1, remaining: 1 });
  });
  it("drops a refused punch without blocking the next", async () => {
    const r = await drainQueue(
      [p("a", "2026-11-04T09:00:00Z"), p("b", "2026-11-04T18:00:00Z", "out")],
      async (x) => (x.id === "a" ? { ok: false, error: "outside geo-fence" } : { ok: true }),
      async () => undefined,
    );
    expect(r).toEqual({ synced: 1, rejected: ["outside geo-fence"], remaining: 0 });
  });
});
