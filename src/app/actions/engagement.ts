"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { assertFlagOn } from "@/lib/enterprise/flags-server";
import {
  employees,
  RECOGNITION_VALUES,
  recognitions,
  surveyParticipation,
  surveyResponses,
  surveys,
  type SurveyQuestion,
} from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { responseSentiment } from "@/lib/surveys/sentiment";

const uuid = z.string().uuid();

const recogSchema = z.object({
  toEmployeeId: uuid,
  value: z.enum(RECOGNITION_VALUES),
  message: z.string().trim().min(3, "Write a few words.").max(280),
});
const DAILY_LIMIT = 5;

export async function giveRecognitionAction(input: unknown) {
  const d = recogSchema.parse(input);
  return runAction(
    "recognition:give",
    async ({ ctx, tx, audit }) => {
      await assertFlagOn(tx, ctx.organizationId, "recognition");
      if (!ctx.employeeId)
        throw new UserFacingError("Your login is not linked to an employee record.");
      if (d.toEmployeeId === ctx.employeeId)
        throw new UserFacingError("You cannot recognise yourself.");
      const [to] = await tx
        .select({ id: employees.id, first: employees.firstName, u: employees.userId })
        .from(employees)
        .where(
          and(
            eq(employees.id, d.toEmployeeId),
            eq(employees.organizationId, ctx.organizationId),
            sql`${employees.deletedAt} is null`,
          ),
        );
      if (!to) throw new UserFacingError("Colleague not found.");
      const dayAgo = new Date(Date.now() - 86_400_000);
      const [c] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(recognitions)
        .where(
          and(eq(recognitions.fromEmployeeId, ctx.employeeId), gte(recognitions.createdAt, dayAgo)),
        );
      if ((c?.n ?? 0) >= DAILY_LIMIT)
        throw new UserFacingError(`You can recognise up to ${DAILY_LIMIT} people a day.`);
      const [row] = await tx
        .insert(recognitions)
        .values({
          organizationId: ctx.organizationId,
          fromEmployeeId: ctx.employeeId,
          toEmployeeId: to.id,
          value: d.value,
          message: d.message,
        })
        .returning({ id: recognitions.id });
      await notify(tx, ctx.organizationId, {
        userId: to.u,
        type: "recognition",
        title: `${ctx.user.name} recognised you`,
        body: d.message,
        href: "/recognition",
      });
      await audit({
        action: "recognition.given",
        entityType: "recognition",
        entityId: row.id,
        newValues: { to: to.id, value: d.value },
      });
      return { id: row.id };
    },
    ["/recognition"],
  );
}

const questionSchema = z.object({
  text: z.string().trim().min(3).max(200),
  kind: z.enum(["scale", "text"]),
});
const createSchema = z.object({
  title: z.string().trim().min(3, "Give the survey a title.").max(120),
  description: z.string().trim().max(400).optional(),
  byDepartment: z.boolean(),
  questions: z.array(questionSchema).min(1, "Add a question.").max(12),
});

export async function createSurveyAction(input: unknown) {
  const d = createSchema.parse(input);
  return runAction(
    "surveys:manage",
    async ({ ctx, tx, audit }) => {
      await assertFlagOn(tx, ctx.organizationId, "surveys");
      const questions: SurveyQuestion[] = d.questions.map((q, i) => ({ id: `q${i + 1}`, ...q }));
      const [row] = await tx
        .insert(surveys)
        .values({
          organizationId: ctx.organizationId,
          title: d.title,
          description: d.description ?? null,
          byDepartment: d.byDepartment,
          questions,
          createdBy: ctx.user.id,
        })
        .returning({ id: surveys.id });
      await audit({
        action: "survey.created",
        entityType: "survey",
        entityId: row.id,
        newValues: { title: d.title, questions: questions.length, byDepartment: d.byDepartment },
      });
      return { id: row.id };
    },
    ["/surveys"],
  );
}

export async function closeSurveyAction(input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  return runAction(
    "surveys:manage",
    async ({ ctx, tx, audit }) => {
      const r = await tx
        .update(surveys)
        .set({ status: "closed" })
        .where(
          and(
            eq(surveys.id, id),
            eq(surveys.organizationId, ctx.organizationId),
            eq(surveys.status, "open"),
          ),
        )
        .returning({ id: surveys.id });
      if (r.length === 0) throw new UserFacingError("Survey not found or already closed.");
      await audit({ action: "survey.closed", entityType: "survey", entityId: id });
      return {};
    },
    ["/surveys"],
  );
}

const submitSchema = z.object({
  surveyId: uuid,
  answers: z.record(z.string(), z.union([z.number().int().min(1).max(5), z.string().max(1000)])),
});

/**
 * Records one anonymous response. Who has answered goes in one table and what they said in another
 * that holds no user, no employee, no timestamp: only the date. The unique participation row is what
 * stops a second answer.
 */
export async function submitSurveyAction(input: unknown) {
  const d = submitSchema.parse(input);
  return runAction(
    "org:read",
    async ({ ctx, tx }) => {
      await assertFlagOn(tx, ctx.organizationId, "surveys");
      const [s] = await tx
        .select()
        .from(surveys)
        .where(and(eq(surveys.id, d.surveyId), eq(surveys.organizationId, ctx.organizationId)));
      if (!s || s.status !== "open") throw new UserFacingError("This survey is closed.");
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      if (s.closesOn && s.closesOn < today) throw new UserFacingError("This survey is closed.");
      const clean: Record<string, number | string> = {};
      const scales: number[] = [];
      let comment = "";
      for (const q of s.questions) {
        const v = d.answers[q.id];
        if (q.kind === "scale") {
          if (typeof v !== "number")
            throw new UserFacingError("Please answer every rating question.");
          clean[q.id] = v;
          scales.push(v);
        } else if (typeof v === "string" && v.trim()) {
          clean[q.id] = v.trim();
          comment += ` ${v}`;
        }
      }
      let departmentId: string | null = null;
      if (s.byDepartment && ctx.employeeId) {
        const [e] = await tx
          .select({ d: employees.departmentId })
          .from(employees)
          .where(eq(employees.id, ctx.employeeId));
        departmentId = e?.d ?? null;
      }
      const ins = await tx
        .insert(surveyParticipation)
        .values({ organizationId: ctx.organizationId, surveyId: s.id, userId: ctx.user.id })
        .onConflictDoNothing()
        .returning({ id: surveyParticipation.id });
      if (ins.length === 0) throw new UserFacingError("You have already answered this survey.");
      const sent = responseSentiment(scales, comment);
      await tx.insert(surveyResponses).values({
        organizationId: ctx.organizationId,
        surveyId: s.id,
        departmentId,
        answers: clean,
        sentiment: sent.sentiment,
        sentimentScore: sent.score,
        submittedOn: today,
      });
      // Deliberately no audit entry naming the user: it would link them to the response.
      return {};
    },
    ["/surveys"],
  );
}
