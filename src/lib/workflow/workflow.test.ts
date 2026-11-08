import { describe, expect, it, vi } from "vitest";
import { evalCondition, interpolate, MAX_ATTEMPTS, runWorkflow, type Executor } from "./engine";
import { validateDefinition } from "./model";
import { TEMPLATES } from "./templates";
import type { WorkflowDefinition } from "@/lib/db/schema";

const payload = {
  leave: { days: 5, type: "Casual", from: "2026-12-01" },
  employee: { name: "Asha", department: "Eng" },
};

describe("interpolate and conditions", () => {
  it("fills known paths and blanks unknown ones", () => {
    expect(interpolate("Hi {{employee.name}} {{leave.days}}d {{nope.x}}!", payload)).toBe(
      "Hi Asha 5d !",
    );
    expect(interpolate("{{employee}}", payload)).toBe("");
  });
  it("compares numbers numerically and text case-insensitively", () => {
    expect(evalCondition({ field: "leave.days", op: "gt", value: 3 }, payload)).toBe(true);
    expect(evalCondition({ field: "leave.days", op: "gt", value: "10" }, payload)).toBe(false);
    expect(evalCondition({ field: "employee.department", op: "eq", value: "eng" }, payload)).toBe(
      true,
    );
    expect(evalCondition({ field: "employee.name", op: "contains", value: "SH" }, payload)).toBe(
      true,
    );
    expect(evalCondition({ field: "missing.field", op: "eq", value: "x" }, payload)).toBe(false);
  });
});

describe("templates", () => {
  it("ships 8 valid templates covering every trigger", () => {
    expect(TEMPLATES).toHaveLength(8);
    expect(new Set(TEMPLATES.map((t) => t.trigger)).size).toBe(3 + 1 - 0); // leave, payroll, employee, deadline
    for (const t of TEMPLATES) {
      const issues = validateDefinition(t.build());
      // Placeholders like replace-me URLs are valid URLs, so every template is runnable as shipped.
      expect(issues, t.key).toEqual([]);
    }
  });
});

describe("validateDefinition", () => {
  const base = (): WorkflowDefinition => TEMPLATES[0].build();
  it("rejects loops, orphans, two approvals and a missing trigger", () => {
    const loop = base();
    loop.edges.push({ id: "x", source: "ok", target: "c" });
    expect(validateDefinition(loop).some((i) => /loop/.test(i.message))).toBe(true);
    const orphan = base();
    orphan.nodes.push({
      id: "z",
      type: "action",
      position: { x: 0, y: 0 },
      data: { action: "notify", config: { audience: "hr", title: "x" } },
    });
    expect(validateDefinition(orphan).some((i) => i.nodeId === "z")).toBe(true);
    const two = base();
    two.nodes.push({
      id: "a2",
      type: "action",
      position: { x: 0, y: 0 },
      data: { action: "approval", config: { title: "t", assigneeRole: "hr_admin" } },
    });
    expect(validateDefinition(two).some((i) => /one approval/.test(i.message))).toBe(true);
    expect(
      validateDefinition({ nodes: [], edges: [] }).some((i) => /trigger/.test(i.message)),
    ).toBe(true);
  });
  it("flags incomplete configs on the right node", () => {
    const d = base();
    const email = d.nodes.find((n) => n.id === "ok")!;
    email.data = { action: "email", config: { to: "custom", subject: "s", body: "b" } };
    expect(validateDefinition(d).find((i) => i.nodeId === "ok")?.message).toMatch(/email address/);
  });
});

describe("runWorkflow", () => {
  const exec = (impl?: Executor): Executor => impl ?? (async () => ({ status: "ok" }));
  const def = TEMPLATES.find((t) => t.key === "new-joiner-welcome")!.build();
  const sleep = async () => {};

  it("runs every step of a simple flow and logs each", async () => {
    const calls: string[] = [];
    const r = await runWorkflow({
      definition: def,
      payload,
      exec: exec(async (a) => (calls.push(a), { status: "ok" })),
      sleep,
    });
    expect(r.status).toBe("succeeded");
    expect(calls).toEqual(["email", "task", "task"]);
    expect(r.steps.map((s) => s.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
  });

  it("follows only the matching condition branch", async () => {
    const d = TEMPLATES.find((t) => t.key === "deadline-escalation")!.build();
    const calls: string[] = [];
    const run = (daysLeft: number) =>
      runWorkflow({
        definition: d,
        payload: { deadline: { daysLeft } },
        exec: exec(async (a) => (calls.push(a), { status: "ok" })),
        sleep,
      });
    await run(5);
    expect(calls).toEqual([]);
    await run(1);
    expect(calls.sort()).toEqual(["task", "whatsapp"]);
  });

  it("retries a failing action, then fails the run with the reason and stops", async () => {
    let n = 0;
    const r = await runWorkflow({
      definition: def,
      payload,
      sleep,
      exec: async (a) => {
        if (a === "email") {
          n++;
          throw new Error("SMTP down");
        }
        return { status: "ok" };
      },
    });
    expect(n).toBe(MAX_ATTEMPTS);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/SMTP down/);
    expect(r.steps.at(-1)?.attempts).toBe(MAX_ATTEMPTS);
  });

  it("succeeds when a retry works, without repeating on a later resume", async () => {
    let n = 0;
    const flaky: Executor = async (a) => {
      if (a === "email" && ++n < 2) throw new Error("blip");
      return { status: "ok" };
    };
    const first = await runWorkflow({ definition: def, payload, exec: flaky, sleep });
    expect(first.status).toBe("succeeded");
    expect(first.steps.find((s) => s.label === "Send email")?.attempts).toBe(2);
    // Re-running with the previous log does not send the email again.
    const spy = vi.fn(async () => ({ status: "ok" as const }));
    await runWorkflow({ definition: def, payload, previous: first.steps, exec: spy, sleep });
    expect(spy).not.toHaveBeenCalled();
  });

  it("pauses on approval and resumes down the decided branch", async () => {
    const d = TEMPLATES[0].build();
    const exec2: Executor = async (a) =>
      a === "approval" ? { status: "ok", waiting: true } : { status: "ok" };
    const paused = await runWorkflow({ definition: d, payload, exec: exec2, sleep });
    expect(paused.status).toBe("waiting");
    expect(paused.waitingNodeId).toBe("a");
    const calls: string[] = [];
    const approved = await runWorkflow({
      definition: d,
      payload,
      previous: paused.steps,
      decision: { nodeId: "a", approved: true },
      exec: async (a, cfg) => (calls.push(`${a}:${String(cfg.subject)}`), { status: "ok" }),
      sleep,
    });
    expect(approved.status).toBe("succeeded");
    expect(calls).toEqual(["email:Your long leave was reviewed"]);
    const rejected = await runWorkflow({
      definition: d,
      payload,
      previous: paused.steps,
      decision: { nodeId: "a", approved: false },
      exec: async (a, cfg) => (calls.push(`${a}:${String(cfg.subject)}`), { status: "ok" }),
      sleep,
    });
    expect(rejected.status).toBe("succeeded");
    expect(calls.at(-1)).toBe("email:About your leave request");
  });

  it("does not start the approval branch when the condition is false", async () => {
    const r = await runWorkflow({
      definition: TEMPLATES[0].build(),
      payload: { leave: { days: 1 } },
      exec: exec(),
      sleep,
    });
    expect(r.status).toBe("succeeded");
    expect(r.steps.map((s) => s.label)).toEqual(["Trigger", "Condition"]);
  });
});
