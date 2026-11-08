import { desc, eq, isNull, and } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiKeyForm,
  EndpointButtons,
  RedeliverButton,
  RevokeKeyButton,
  WebhookForm,
} from "@/components/workflows/developer-forms";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { apiKeys, webhookDeliveries, webhookEndpoints } from "@/lib/db/schema";
import { WEBHOOK_EVENTS } from "@/lib/workflow/events";

export const metadata = { title: "Developers" };
export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
const TONE = { delivered: "success", failed: "danger", pending: "warning" } as const;

const VERIFY = `// Node.js receiver: verify before trusting the body
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, headers) {
  const ts = headers["x-payflow-timestamp"];
  const sig = headers["x-payflow-signature"]; // "v1=<hex>"
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window
  const want = "v1=" + createHmac("sha256", secret).update(ts + "." + rawBody).digest("hex");
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}`;

export default async function DevelopersPage() {
  const ctx = await requirePagePermission("apikeys:manage");
  const orgId = ctx.organizationId;
  const { keys, endpoints, deliveries } = await withTenant(orgId, async (tx) => ({
    keys: await tx
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, orgId))
      .orderBy(desc(apiKeys.createdAt)),
    endpoints: await tx
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.organizationId, orgId), isNull(webhookEndpoints.deletedAt)))
      .orderBy(desc(webhookEndpoints.createdAt)),
    deliveries: await tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.organizationId, orgId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(15),
  }));
  const urlOf = new Map(endpoints.map((e) => [e.id, e.url]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Developers</h1>
        <p className="text-muted-foreground text-sm">
          Read your data over a REST API and get signed webhooks when things happen.{" "}
          <a className="text-primary hover:underline" href="/api/v1/openapi.json">
            OpenAPI spec
          </a>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Read-only. Bank, PAN and Aadhaar numbers are never returned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ApiKeyForm />
          <div className="divide-y">
            {keys.length === 0 && (
              <p className="text-muted-foreground py-2 text-sm">No keys yet.</p>
            )}
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {k.name} <code className="text-muted-foreground text-xs">{k.prefix}…</code>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {k.scopes.join(", ")} · {k.rateLimitPerMin}/min ·{" "}
                    {k.lastUsedAt ? `used ${fmt.format(k.lastUsedAt)}` : "never used"}
                    {k.expiresAt ? ` · expires ${fmt.format(k.expiresAt)}` : ""}
                  </p>
                </div>
                {k.revokedAt ? (
                  <Badge tone="danger">Revoked</Badge>
                ) : (
                  <RevokeKeyButton id={k.id} name={k.name} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>
            Failed deliveries retry with increasing delays for about 11 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <WebhookForm events={WEBHOOK_EVENTS} />
          <div className="divide-y">
            {endpoints.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.url}</p>
                  <p className="text-muted-foreground text-xs">{e.events.join(", ")}</p>
                </div>
                <EndpointButtons id={e.id} url={e.url} />
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Recent deliveries</p>
            <div className="divide-y">
              {deliveries.length === 0 && (
                <p className="text-muted-foreground text-sm">None yet.</p>
              )}
              {deliveries.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <code>{d.event}</code>{" "}
                      <span className="text-muted-foreground">
                        to {urlOf.get(d.endpointId) ?? "removed endpoint"}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {fmt.format(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                      {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                      {d.lastError ? ` · ${d.lastError}` : ""}
                    </p>
                  </div>
                  <Badge tone={TONE[d.status as keyof typeof TONE] ?? "neutral"}>{d.status}</Badge>
                  {d.status === "failed" && <RedeliverButton id={d.id} />}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">{`curl -H "Authorization: Bearer pf_live_…" \\\n  "${"<your-domain>"}/api/v1/employees?status=active&limit=25"`}</pre>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5">
            <li>
              <code>GET /api/v1/employees</code>, <code>/employees/:id</code> (employees:read)
            </li>
            <li>
              <code>GET /api/v1/payroll-runs</code>, <code>/payroll-runs/:id</code> (payroll:read),
              amounts in paise
            </li>
            <li>
              <code>GET /api/v1/leave-requests</code> (leave:read)
            </li>
            <li>
              <code>GET /api/v1/attendance?from=&amp;to=&amp;employeeId=</code> (attendance:read)
            </li>
            <li>
              Rate limit headers: <code>x-ratelimit-limit</code>, <code>-remaining</code>,{" "}
              <code>-reset</code>. Over the limit returns 429 with <code>retry-after</code>.
            </li>
          </ul>
          <div>
            <p className="mb-1 font-medium">Verifying webhook signatures</p>
            <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">{VERIFY}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
