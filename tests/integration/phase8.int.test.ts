import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { hashKey } from "@/lib/api/keys";
import { encrypt } from "@/lib/crypto";
import { verifySignature } from "@/lib/workflow/signing";
import { TEMPLATES } from "@/lib/workflow/templates";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.ALLOW_PRIVATE_WEBHOOKS = "1";
}
const d = describe.skipIf(!url);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err, "expected the database to reject the statement").not.toBeNull();
  expect(`${err?.message ?? ""} ${err?.cause?.message ?? ""}`).toMatch(pattern);
}

d("phase 8: automation, API keys, webhooks", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const hrUser = `hr-${randomUUID()}`;
  const inTenant = <T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  const mkWorkflow = (org: string, key: string, enabled = true) =>
    inTenant(org, async (tx) => {
      const t = TEMPLATES.find((x) => x.key === key)!;
      const [w] = await tx
        .insert(schema.workflows)
        .values({
          organizationId: org,
          name: t.name,
          triggerKind: t.trigger,
          definition: t.build(),
          enabled,
        })
        .returning();
      return w;
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await db.insert(schema.users).values({ id: hrUser, name: "HR", email: `${hrUser}@x.in` });
    for (const id of [orgA, orgB])
      await inTenant(id, (tx) =>
        tx.insert(schema.organizations).values({ id, name: id, slug: `p8-${id.slice(0, 8)}` }),
      );
    await inTenant(orgA, (tx) =>
      tx
        .insert(schema.memberships)
        .values({ organizationId: orgA, userId: hrUser, role: "hr_admin" }),
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  describe("row-level security", () => {
    it("keeps workflows, runs, tasks, keys, endpoints and deliveries inside one company", async () => {
      const wf = await mkWorkflow(orgA, "new-joiner-welcome");
      const [run] = await inTenant(orgA, (tx) =>
        tx
          .insert(schema.workflowRuns)
          .values({
            organizationId: orgA,
            workflowId: wf.id,
            triggerKind: wf.triggerKind,
            payload: {},
          })
          .returning(),
      );
      await inTenant(orgA, (tx) =>
        tx.insert(schema.workflowTasks).values({ organizationId: orgA, runId: run.id, title: "t" }),
      );
      await inTenant(orgA, (tx) =>
        tx.insert(schema.apiKeys).values({
          organizationId: orgA,
          name: "k",
          prefix: "pf_live_x",
          keyHash: hashKey(`rls-${randomUUID()}`),
          scopes: ["employees:read"],
        }),
      );
      const [ep] = await inTenant(orgA, (tx) =>
        tx
          .insert(schema.webhookEndpoints)
          .values({
            organizationId: orgA,
            url: "https://e.x",
            secretEnc: "x",
            events: ["leave.applied"],
          })
          .returning(),
      );
      await inTenant(orgA, (tx) =>
        tx
          .insert(schema.webhookDeliveries)
          .values({ organizationId: orgA, endpointId: ep.id, event: "leave.applied", payload: {} }),
      );
      for (const t of [
        schema.workflows,
        schema.workflowRuns,
        schema.workflowTasks,
        schema.apiKeys,
        schema.webhookEndpoints,
        schema.webhookDeliveries,
      ])
        expect(
          await inTenant(orgB, (tx) => tx.select().from(t)),
          t[Symbol.for("drizzle:Name") as never],
        ).toHaveLength(0);
      // And B cannot write rows that claim to belong to A.
      await expectDbError(
        inTenant(orgB, (tx) =>
          tx.insert(schema.workflows).values({
            organizationId: orgA,
            name: "x",
            triggerKind: "leave.applied",
            definition: { nodes: [], edges: [] },
          }),
        ),
        /row-level security/,
      );
    });
  });

  describe("constraints", () => {
    it("rejects bad statuses, rate limits and duplicate dedupe keys", async () => {
      const wf = await mkWorkflow(orgA, "leave-to-teams");
      const base = {
        organizationId: orgA,
        workflowId: wf.id,
        triggerKind: wf.triggerKind,
        payload: {},
      };
      await expectDbError(
        inTenant(orgA, (tx) => tx.insert(schema.workflowRuns).values({ ...base, status: "bogus" })),
        /workflow_runs_status/,
      );
      await expectDbError(
        inTenant(orgA, (tx) =>
          tx.insert(schema.apiKeys).values({
            organizationId: orgA,
            name: "k",
            prefix: "p",
            keyHash: hashKey(`rate0-${randomUUID()}`),
            scopes: ["x"],
            rateLimitPerMin: 0,
          }),
        ),
        /api_keys_rate/,
      );
      await inTenant(orgA, (tx) =>
        tx.insert(schema.workflowRuns).values({ ...base, dedupeKey: "once" }),
      );
      await expectDbError(
        inTenant(orgA, (tx) =>
          tx.insert(schema.workflowRuns).values({ ...base, dedupeKey: "once" }),
        ),
        /workflow_runs_dedupe_uq/,
      );
      // Runs without a key are never deduplicated.
      await inTenant(orgA, (tx) => tx.insert(schema.workflowRuns).values([base, base]));
    });
  });

  describe("resolve_api_key", () => {
    const tag = randomUUID();
    const resolve = async (h: string) =>
      (await db.execute(sql`select * from resolve_api_key(${h})`)).rows as {
        organization_id: string;
        scopes: string[];
      }[];
    it("finds only active, unexpired keys, without any tenant context", async () => {
      const mk = (k: string, extra: Partial<typeof schema.apiKeys.$inferInsert> = {}) =>
        inTenant(orgA, (tx) =>
          tx.insert(schema.apiKeys).values({
            organizationId: orgA,
            name: k,
            prefix: "p",
            keyHash: hashKey(k),
            scopes: ["payroll:read"],
            ...extra,
          }),
        );
      await mk(`good-${tag}`);
      await mk(`revoked-${tag}`, { revokedAt: new Date() });
      await mk(`expired-${tag}`, { expiresAt: new Date(Date.now() - 1000) });
      const good = await resolve(hashKey(`good-${tag}`));
      expect(good).toHaveLength(1);
      expect(good[0].organization_id).toBe(orgA);
      expect(good[0].scopes).toEqual(["payroll:read"]);
      expect(await resolve(hashKey(`revoked-${tag}`))).toHaveLength(0);
      expect(await resolve(hashKey(`expired-${tag}`))).toHaveLength(0);
      expect(await resolve(hashKey("never-created"))).toHaveLength(0);
      // The plaintext is never a lookup key: only the hash is stored.
      expect(await resolve(`good-${tag}`)).toHaveLength(0);
    });
  });

  describe("cross-company sweep helpers", () => {
    it("lists companies and only due, pending deliveries", async () => {
      const orgs = (
        (await db.execute(sql`select automation_org_ids() as id`)).rows as { id: string }[]
      ).map((r) => r.id);
      expect(orgs).toEqual(expect.arrayContaining([orgA, orgB]));
      const [ep] = await inTenant(orgA, (tx) =>
        tx
          .insert(schema.webhookEndpoints)
          .values({ organizationId: orgA, url: "https://e.x", secretEnc: "x", events: ["ping"] })
          .returning(),
      );
      const mk = (status: string, next: Date) =>
        inTenant(orgA, (tx) =>
          tx
            .insert(schema.webhookDeliveries)
            .values({
              organizationId: orgA,
              endpointId: ep.id,
              event: "ping",
              payload: {},
              status,
              nextAttemptAt: next,
            })
            .returning({ id: schema.webhookDeliveries.id }),
        );
      const [due] = await mk("pending", new Date(Date.now() - 5000));
      const [later] = await mk("pending", new Date(Date.now() + 3_600_000));
      const [done] = await mk("delivered", new Date(Date.now() - 5000));
      const ids = (
        (await db.execute(sql`select id from due_webhook_deliveries(500)`)).rows as { id: string }[]
      ).map((r) => r.id);
      expect(ids).toContain(due.id);
      expect(ids).not.toContain(later.id);
      expect(ids).not.toContain(done.id);
    });
  });

  describe("event dispatch and execution", () => {
    it("runs a matching workflow end to end and logs every step", async () => {
      const { emitEvent } = await import("@/lib/workflow/dispatch");
      const org = randomUUID();
      await inTenant(org, (tx) =>
        tx
          .insert(schema.organizations)
          .values({ id: org, name: org, slug: `p8-${org.slice(0, 8)}` }),
      );
      await mkWorkflow(org, "new-joiner-welcome");
      await mkWorkflow(org, "leave-to-teams"); // different trigger: must not run
      await mkWorkflow(org, "new-joiner-announce", false); // disabled: must not run
      const out = await emitEvent(org, "employee.joined", {
        employee: {
          name: "Asha",
          email: "a@x.in",
          department: "Eng",
          designation: "Dev",
          joinDate: "2026-12-01",
        },
      });
      expect(out.runIds).toHaveLength(1);
      const runs = await inTenant(org, (tx) => tx.select().from(schema.workflowRuns));
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("succeeded");
      const emailStep = runs[0].steps.find((s) => s.label === "Send email");
      expect(emailStep?.status).toBe("skipped"); // no RESEND_API_KEY here: says so instead of pretending
      expect(emailStep?.note).toMatch(/not configured/);
      const tasks = await inTenant(org, (tx) => tx.select().from(schema.workflowTasks));
      expect(tasks.map((t) => t.title).sort()).toEqual([
        "Collect documents from Asha",
        "Prepare laptop and access for Asha",
      ]);
    });

    it("pauses on an approval, resumes the right branch, and a decision cannot be replayed", async () => {
      const { emitEvent, processRun } = await import("@/lib/workflow/dispatch");
      const org = randomUUID();
      await inTenant(org, (tx) =>
        tx
          .insert(schema.organizations)
          .values({ id: org, name: org, slug: `p8-${org.slice(0, 8)}` }),
      );
      await mkWorkflow(org, "long-leave-approval");
      const out = await emitEvent(org, "leave.applied", {
        employee: { name: "Ravi", email: "" },
        leave: { days: 6, type: "Casual", from: "2026-12-01" },
      });
      const [run] = await inTenant(org, (tx) =>
        tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, out.runIds[0])),
      );
      expect(run.status).toBe("waiting");
      expect(run.waitingNodeId).toBe("a");
      const [task] = await inTenant(org, (tx) =>
        tx.select().from(schema.workflowTasks).where(eq(schema.workflowTasks.runId, run.id)),
      );
      expect(task.kind).toBe("approval");
      await processRun(org, run.id, { nodeId: "a", approved: false });
      const [after] = await inTenant(org, (tx) =>
        tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.id)),
      );
      expect(after.status).toBe("succeeded");
      expect(after.steps.some((s) => s.label.includes("Send email"))).toBe(true);
      const stepCount = after.steps.length;
      await processRun(org, run.id, { nodeId: "a", approved: true }); // no longer waiting: ignored
      const [again] = await inTenant(org, (tx) =>
        tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.id)),
      );
      expect(again.steps).toHaveLength(stepCount);
    });

    it("does not start the approval when the condition is false", async () => {
      const { emitEvent } = await import("@/lib/workflow/dispatch");
      const org = randomUUID();
      await inTenant(org, (tx) =>
        tx
          .insert(schema.organizations)
          .values({ id: org, name: org, slug: `p8-${org.slice(0, 8)}` }),
      );
      await mkWorkflow(org, "long-leave-approval");
      await emitEvent(org, "leave.applied", { employee: { name: "R" }, leave: { days: 1 } });
      expect(await inTenant(org, (tx) => tx.select().from(schema.workflowTasks))).toHaveLength(0);
    });

    it("emitting with a dedupe key twice creates one run and one delivery", async () => {
      const { emitEvent } = await import("@/lib/workflow/dispatch");
      const org = randomUUID();
      await inTenant(org, (tx) =>
        tx
          .insert(schema.organizations)
          .values({ id: org, name: org, slug: `p8-${org.slice(0, 8)}` }),
      );
      await mkWorkflow(org, "compliance-reminder");
      await inTenant(org, (tx) =>
        tx.insert(schema.webhookEndpoints).values({
          organizationId: org,
          url: "https://203.0.113.5/h",
          secretEnc: encrypt("s"),
          events: ["deadline.near"],
        }),
      );
      const payload = { deadline: { label: "PF", dueDate: "2026-11-15", daysLeft: 2 } };
      const a = await emitEvent(org, "deadline.near", payload, "deadline:1");
      const b = await emitEvent(org, "deadline.near", payload, "deadline:1");
      expect(a.runIds).toHaveLength(1);
      expect(b.runIds).toHaveLength(0);
      expect(b.deliveryIds).toHaveLength(0);
      expect(await inTenant(org, (tx) => tx.select().from(schema.workflowRuns))).toHaveLength(1);
    });

    it("marks a run failed after retries, notifies admins, and retry does not repeat finished steps", async () => {
      const { emitEvent, processRun } = await import("@/lib/workflow/dispatch");
      // Slack step pointing at a private address is blocked by the SSRF guard (guard enabled for this one URL form).
      const prev = process.env.ALLOW_PRIVATE_WEBHOOKS;
      delete process.env.ALLOW_PRIVATE_WEBHOOKS;
      try {
        const wf = await mkWorkflow(orgA, "payroll-approved-notify");
        const out = await emitEvent(orgA, "payroll.approved", {
          run: { monthLabel: "2026-10", employees: 3, totalNetInr: "₹1" },
        });
        const id = out.runIds.at(-1)!;
        const [run] = await inTenant(orgA, (tx) =>
          tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, id)),
        );
        expect(wf.id).toBeTruthy();
        expect(run.status).toBe("failed");
        expect(run.error).toMatch(/https|private|resolve|ENOTFOUND|EAI_AGAIN|fetch/i);
        const bell = await inTenant(orgA, (tx) =>
          tx
            .select()
            .from(schema.notifications)
            .where(
              and(
                eq(schema.notifications.userId, hrUser),
                eq(schema.notifications.type, "workflow_failed"),
              ),
            ),
        );
        expect(bell.length).toBeGreaterThan(0);
        await processRun(orgA, id); // retry: still failing, but steps are not duplicated
        const [r2] = await inTenant(orgA, (tx) =>
          tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, id)),
        );
        expect(r2.attempts).toBe(2);
      } finally {
        if (prev) process.env.ALLOW_PRIVATE_WEBHOOKS = prev;
      }
    });
  });

  describe("webhook delivery", () => {
    it("signs the body, retries with backoff on failure, gives up after the limit", async () => {
      const { deliverWebhook } = await import("@/lib/workflow/dispatch");
      const secret = "whsec_testsecret";
      let respond = 200;
      const seen: { body: string; headers: IncomingMessage["headers"] }[] = [];
      const server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          seen.push({ body, headers: req.headers });
          res.statusCode = respond;
          res.end("ok");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as AddressInfo).port;
      try {
        const [ep] = await inTenant(orgA, (tx) =>
          tx
            .insert(schema.webhookEndpoints)
            .values({
              organizationId: orgA,
              url: `http://127.0.0.1:${port}/h`,
              secretEnc: encrypt(secret),
              events: ["ping"],
            })
            .returning(),
        );
        const mk = () =>
          inTenant(orgA, (tx) =>
            tx
              .insert(schema.webhookDeliveries)
              .values({ organizationId: orgA, endpointId: ep.id, event: "ping", payload: { n: 1 } })
              .returning({ id: schema.webhookDeliveries.id }),
          );
        const get = (id: string) =>
          inTenant(
            orgA,
            async (tx) =>
              (
                await tx
                  .select()
                  .from(schema.webhookDeliveries)
                  .where(eq(schema.webhookDeliveries.id, id))
              )[0],
          );

        const [ok] = await mk();
        await deliverWebhook(orgA, ok.id);
        const delivered = await get(ok.id);
        expect(delivered.status).toBe("delivered");
        expect(delivered.responseStatus).toBe(200);
        const hit = seen.at(-1)!;
        expect(
          verifySignature(
            secret,
            hit.body,
            String(hit.headers["x-payflow-timestamp"]),
            String(hit.headers["x-payflow-signature"]),
          ),
        ).toBe(true);
        expect(JSON.parse(hit.body)).toMatchObject({ id: ok.id, event: "ping", data: { n: 1 } });
        await deliverWebhook(orgA, ok.id); // already delivered: not sent again
        expect(seen.filter((s) => s.body.includes(ok.id))).toHaveLength(1);

        respond = 500;
        const [bad] = await mk();
        await deliverWebhook(orgA, bad.id);
        const once = await get(bad.id);
        expect(once.status).toBe("pending");
        expect(once.attempts).toBe(1);
        expect(once.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
        await inTenant(orgA, (tx) =>
          tx
            .update(schema.webhookDeliveries)
            .set({ attempts: 5 })
            .where(eq(schema.webhookDeliveries.id, bad.id)),
        );
        await deliverWebhook(orgA, bad.id);
        const failed = await get(bad.id);
        expect(failed.status).toBe("failed");
        expect(failed.attempts).toBe(6);
        expect(failed.lastError).toMatch(/500/);
      } finally {
        server.close();
      }
    });
  });

  describe("automatic payroll pipeline", { timeout: 30_000 }, () => {
    it("stops at the first problem, says why, and notifies once", async () => {
      const { advancePipeline } = await import("@/lib/pipeline/sweep");
      // orgB has no employees with salaries: drafting payroll is impossible, so the pipeline must hold.
      await inTenant(orgB, (tx) =>
        tx
          .insert(schema.memberships)
          .values({ organizationId: orgB, userId: hrUser, role: "hr_admin" }),
      );
      const stop = await advancePipeline(orgB, "2026-10");
      expect(stop).toBe("draft");
      const steps = await inTenant(orgB, (tx) => tx.select().from(schema.pipelineSteps));
      expect(steps.find((s) => s.step === "lock")?.status).toBe("done");
      const draft = steps.find((s) => s.step === "draft")!;
      expect(draft.status).toBe("blocked");
      expect(draft.detail).toMatch(/salar/i);
      expect(await inTenant(orgB, (tx) => tx.select().from(schema.payrollRuns))).toHaveLength(0);
      const count = async () =>
        (
          await inTenant(orgB, (tx) =>
            tx.select().from(schema.notifications).where(eq(schema.notifications.type, "pipeline")),
          )
        ).length;
      const first = await count();
      expect(first).toBe(1);
      await advancePipeline(orgB, "2026-10"); // same blocker: no second notification
      expect(await count()).toBe(first);
    });

    it("raises each deadline event once, however often the sweep runs", async () => {
      const { raiseDeadlineEvents } = await import("@/lib/pipeline/sweep");
      const org = randomUUID();
      await inTenant(org, (tx) =>
        tx
          .insert(schema.organizations)
          .values({ id: org, name: org, slug: `p8-${org.slice(0, 8)}` }),
      );
      await mkWorkflow(org, "deadline-escalation");
      const today = "2026-11-14";
      const n1 = await raiseDeadlineEvents(org, today);
      const runs1 = (await inTenant(org, (tx) => tx.select().from(schema.workflowRuns))).length;
      expect(n1).toBeGreaterThan(0);
      expect(runs1).toBe(n1);
      await raiseDeadlineEvents(org, today);
      expect(await inTenant(org, (tx) => tx.select().from(schema.workflowRuns))).toHaveLength(
        runs1,
      );
    });
  });
});
