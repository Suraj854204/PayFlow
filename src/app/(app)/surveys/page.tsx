import { and, desc, eq, inArray } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CloseSurveyButton,
  CreateSurveyForm,
  RespondForm,
} from "@/components/engagement/survey-forms";
import { requireFlagOn } from "@/lib/enterprise/flags-server";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/rbac";
import { withTenant } from "@/lib/db";
import { departments, surveyParticipation, surveyResponses, surveys } from "@/lib/db/schema";
import { summarise } from "@/lib/surveys/results";

export const metadata = { title: "Pulse surveys" };
export const dynamic = "force-dynamic";

export default async function SurveysPage() {
  const ctx = await requireContext();
  await withTenant(ctx.organizationId, (tx) => requireFlagOn(tx, ctx.organizationId, "surveys"));
  const manage = can(ctx.role, "surveys:manage");
  const data = await withTenant(ctx.organizationId, async (tx) => {
    const list = await tx
      .select()
      .from(surveys)
      .where(eq(surveys.organizationId, ctx.organizationId))
      .orderBy(desc(surveys.createdAt));
    const done = new Set(
      (
        await tx
          .select({ s: surveyParticipation.surveyId })
          .from(surveyParticipation)
          .where(and(eq(surveyParticipation.userId, ctx.user.id)))
      ).map((r) => r.s),
    );
    const depts = new Map(
      (
        await tx
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(eq(departments.organizationId, ctx.organizationId))
      ).map((d) => [d.id, d.name]),
    );
    const results = new Map<string, ReturnType<typeof summarise>>();
    if (manage && list.length) {
      const rows = await tx
        .select({
          surveyId: surveyResponses.surveyId,
          departmentId: surveyResponses.departmentId,
          answers: surveyResponses.answers,
          sentiment: surveyResponses.sentiment,
        })
        .from(surveyResponses)
        .where(
          inArray(
            surveyResponses.surveyId,
            list.map((s) => s.id),
          ),
        );
      for (const s of list)
        results.set(
          s.id,
          summarise(
            s.questions,
            rows
              .filter((r) => r.surveyId === s.id)
              .map((r) => ({
                departmentId: r.departmentId,
                answers: r.answers,
                sentiment: r.sentiment as "positive" | "neutral" | "negative",
              })),
          ),
        );
    }
    return { list, done, depts, results };
  });
  const open = data.list.filter((s) => s.status === "open" && !data.done.has(s.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pulse surveys</h1>
        <p className="text-muted-foreground text-sm">
          Answers are anonymous. The system records that you answered, never what you said, and
          results appear only once at least 5 people have responded.
        </p>
      </div>

      {open.map((s) => (
        <Card key={s.id} data-testid="open-survey">
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
            {s.description && <CardDescription>{s.description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <RespondForm surveyId={s.id} questions={s.questions} />
          </CardContent>
        </Card>
      ))}
      {open.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground p-5 text-sm">
            No surveys waiting for you.
          </CardContent>
        </Card>
      )}

      {manage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>New survey</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateSurveyForm />
            </CardContent>
          </Card>
          <h2 className="text-lg font-semibold">Results</h2>
          {data.list.map((s) => {
            const r = data.results.get(s.id)!;
            return (
              <Card key={s.id} data-testid="survey-result">
                <CardHeader className="flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle>{s.title}</CardTitle>
                    <CardDescription>
                      {r.responses} response{r.responses === 1 ? "" : "s"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.status === "open" ? "success" : "neutral"}>{s.status}</Badge>
                    {s.status === "open" && <CloseSurveyButton id={s.id} />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {!r.visible ? (
                    <p className="text-muted-foreground">
                      Results are hidden until {r.needed} people have answered ({r.responses} so
                      far). This protects anonymity.
                    </p>
                  ) : (
                    <>
                      <p>
                        Overall average <strong>{r.overallAverage ?? "n/a"}</strong> of 5 ·
                        Sentiment (a rough word-based signal): {r.sentiment.positive} positive,{" "}
                        {r.sentiment.neutral} neutral, {r.sentiment.negative} negative
                      </p>
                      {r.questions.map((q) => (
                        <div key={q.id}>
                          <p className="font-medium">{q.text}</p>
                          {q.kind === "scale" ? (
                            <p className="text-muted-foreground">
                              Average {q.average} · distribution 1–5: {q.distribution.join(" / ")}
                            </p>
                          ) : (
                            <ul className="text-muted-foreground list-disc pl-5">
                              {q.comments.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                      {s.byDepartment && (
                        <div>
                          <p className="font-medium">By department</p>
                          {r.departments.map((d) => (
                            <p key={d.departmentId} className="text-muted-foreground">
                              {data.depts.get(d.departmentId) ?? "Department"}: {d.average ?? "n/a"}{" "}
                              avg from {d.responses} responses
                            </p>
                          ))}
                          {r.hiddenDepartments > 0 && (
                            <p className="text-muted-foreground">
                              {r.hiddenDepartments} smaller department(s) hidden to protect
                              anonymity.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
