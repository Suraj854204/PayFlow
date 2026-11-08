import { CheckCircle2, ShieldAlert } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { queryAudit } from "@/lib/audit";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { withTenant } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/context";
import { verifyChain } from "@/lib/audit-chain";

export const metadata = { title: "Audit log" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("audit:read");

  const rows = await withTenant(ctx.organizationId, (tx) =>
    tx
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, ctx.organizationId))
      .orderBy(asc(auditLogs.seq)),
  );

  const verification = verifyChain(
    rows.map((r) => ({
      organizationId: r.organizationId,
      seq: r.seq,
      actorUserId: r.actorUserId,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      oldValues: r.oldValues,
      newValues: r.newValues,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  );

  const filter = {
    action: sp.action?.trim() || undefined,
    entityType: sp.entity?.trim() || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
  const filtered = Boolean(filter.action || filter.entityType || filter.from || filter.to);
  const recent = filtered
    ? await withTenant(ctx.organizationId, (tx) => queryAudit(tx, ctx.organizationId, filter, 200))
    : [...rows].reverse().slice(0, 100);
  const exportQs = new URLSearchParams(
    Object.entries({
      action: filter.action,
      entity: filter.entityType,
      from: filter.from,
      to: filter.to,
    }).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Append-only and hash-chained. Any edit to history breaks the chain.
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-3 pt-5">
          {verification.valid ? (
            <>
              <CheckCircle2 className="text-success size-5" />
              <div>
                <p className="text-sm font-medium">Chain verified</p>
                <p className="text-muted-foreground text-xs">
                  {rows.length} entries, no tampering detected.
                </p>
              </div>
            </>
          ) : (
            <>
              <ShieldAlert className="text-destructive size-5" />
              <div>
                <p className="text-destructive text-sm font-medium">
                  Integrity problem at entry #{verification.brokenAtSeq}
                </p>
                <p className="text-muted-foreground text-xs">{verification.reason}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            {filtered
              ? `${recent.length} matching entries (max 200), newest first.`
              : "Latest 100 entries, newest first."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="f-action">Action contains</Label>
              <Input
                id="f-action"
                name="action"
                defaultValue={sp.action}
                placeholder="payroll_run"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-entity">Entity type</Label>
              <Input
                id="f-entity"
                name="entity"
                defaultValue={sp.entity}
                placeholder="payroll_run"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-from">From</Label>
              <Input id="f-from" type="date" name="from" defaultValue={sp.from} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-to">To</Label>
              <Input id="f-to" type="date" name="to" defaultValue={sp.to} />
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/audit/export${exportQs ? `?${exportQs}` : ""}`}>
                <Download /> Export CSV
              </a>
            </Button>
          </form>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="text-muted-foreground py-2.5 pr-4 font-mono text-xs">{r.seq}</td>
                  <td className="text-muted-foreground py-2.5 pr-4 whitespace-nowrap">
                    {r.createdAt.toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{r.action}</td>
                  <td className="py-2.5 pr-4">{r.entityType}</td>
                  <td className="py-2.5 pr-4">
                    {r.actorRole ? <Badge>{r.actorRole}</Badge> : "—"}
                  </td>
                  <td className="py-2.5">
                    {r.oldValues || r.newValues ? (
                      <details>
                        <summary className="text-primary cursor-pointer text-xs">View</summary>
                        <pre className="bg-muted mt-1 max-w-md overflow-x-auto rounded p-2 text-xs">{`before: ${JSON.stringify(r.oldValues ?? null)}\nafter:  ${JSON.stringify(r.newValues ?? null)}`}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground py-10 text-center">
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
