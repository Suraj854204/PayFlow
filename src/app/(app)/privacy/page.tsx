import { desc, eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CancelErasure,
  DecideErasure,
  RequestErasure,
} from "@/components/enterprise/privacy-panels";
import { requireContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { employees, privacyRequests } from "@/lib/db/schema";
import { ERASED_FIELDS, RETAINED_RECORDS } from "@/lib/privacy/erasure";
import { can } from "@/lib/rbac";

export const metadata = { title: "My data & privacy" };
export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});
const TONE = {
  pending: "warning",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;

export default async function PrivacyPage() {
  const ctx = await requireContext();
  const t = await getTranslations("privacy");
  const manage = can(ctx.role, "privacy:manage");
  const d = await withTenant(ctx.organizationId, async (tx) => {
    const mine = await tx
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.userId, ctx.user.id))
      .orderBy(desc(privacyRequests.createdAt))
      .limit(20);
    const queue = manage
      ? await tx
          .select({
            r: privacyRequests,
            first: employees.firstName,
            last: employees.lastName,
            code: employees.employeeCode,
            status: employees.status,
          })
          .from(privacyRequests)
          .leftJoin(employees, eq(employees.id, privacyRequests.employeeId))
          .where(eq(privacyRequests.status, "pending"))
          .orderBy(privacyRequests.createdAt)
      : [];
    return { mine, queue: queue.filter((q) => q.r.kind === "erasure") };
  });
  const hasPending = d.mine.some((r) => r.kind === "erasure" && r.status === "pending");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("intro")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("downloadTitle")}</CardTitle>
          <CardDescription>{t("downloadBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="/api/privacy/export"
            download
            className="bg-primary text-primary-foreground inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium"
            data-testid="export-link"
          >
            <Download className="size-4" aria-hidden /> {t("downloadBtn")}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("eraseTitle")}</CardTitle>
          <CardDescription>{t("eraseBody")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-medium">{t("removed")}</p>
              <ul className="text-muted-foreground list-disc pl-5">
                {ERASED_FIELDS.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">{t("kept")}</p>
              <ul className="text-muted-foreground list-disc pl-5">
                {RETAINED_RECORDS.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
          {hasPending ? (
            <p className="text-muted-foreground">{t("waiting")}</p>
          ) : (
            <RequestErasure />
          )}
        </CardContent>
      </Card>

      {d.mine.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My requests</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            {d.mine.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {r.kind === "export" ? "Data export" : "Erasure request"} ·{" "}
                  {when.format(r.createdAt)}
                  {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>
                  {r.kind === "erasure" && r.status === "pending" && <CancelErasure id={r.id} />}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {manage && (
        <Card>
          <CardHeader>
            <CardTitle>Erasure requests to review</CardTitle>
            <CardDescription>
              Approving removes personal details permanently. You cannot approve your own request.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y text-sm" data-testid="erasure-queue">
            {d.queue.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
            {d.queue.map((q) => (
              <div key={q.r.id} className="space-y-2 py-3">
                <p>
                  <strong>{q.first ? `${q.first} ${q.last}`.trim() : "Unknown"}</strong> (
                  {q.code ?? "no record"}) · employment status: {q.status ?? "n/a"} · requested{" "}
                  {when.format(q.r.createdAt)}
                </p>
                {q.r.reason && <p className="text-muted-foreground">“{q.r.reason}”</p>}
                <DecideErasure id={q.r.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
