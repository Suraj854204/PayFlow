"use server";

import { and, eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import {
  explanationSchema,
  figuresAreGrounded,
  templateExplanation,
  type Explanation,
  type PayslipFacts,
} from "@/lib/ai/explain";
import { estimateTokens } from "@/lib/ai/guard";
import { logUsage, tokensUsedToday } from "@/lib/ai/usage";
import { payrollItems, payslips } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { monthLabel } from "@/lib/payroll/period";
import { rateLimit } from "@/lib/rate-limit";

const input = z.object({ payslipId: z.string().uuid(), lang: z.enum(["en", "hi"]) });

/** Explains one of the caller's own payslips in simple English or Hindi. */
export async function explainPayslipAction(raw: unknown) {
  return runAction("payslips:read_own", async ({ ctx, tx }) => {
    const { payslipId, lang } = input.parse(raw);
    if (!ctx.employeeId)
      throw new UserFacingError("Your login is not linked to an employee record.");
    const [row] = await tx
      .select({ i: payrollItems, month: payslips.month })
      .from(payslips)
      .innerJoin(payrollItems, eq(payrollItems.id, payslips.itemId))
      .where(
        and(
          eq(payslips.id, payslipId),
          eq(payslips.organizationId, ctx.organizationId),
          eq(payslips.employeeId, ctx.employeeId),
        ),
      );
    if (!row) throw new UserFacingError("Payslip not found.");
    const facts: PayslipFacts = {
      monthLabel: monthLabel(row.month),
      gross: row.i.gross,
      deductions: row.i.totalDeductions,
      net: row.i.net,
      earnings: row.i.earnings,
      deductionLines: row.i.deductions,
      lopDays: Number(row.i.lopDays),
      paidDays: Number(row.i.paidDays),
    };
    const template = templateExplanation(facts, lang);
    const done = (explanation: Explanation, engine: "model" | "template") => ({
      explanation,
      engine,
    });
    if (!env.GEMINI_API_KEY) return done(template, "template");

    const allowed = await rateLimit("explainer", ctx.user.id, 10, "1 m");
    const used = await tokensUsedToday(tx, ctx.organizationId, ctx.user.id);
    if (!allowed.success || used >= env.AI_DAILY_TOKEN_LIMIT) {
      await logUsage(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        feature: "explainer",
        model: env.GEMINI_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        status: allowed.success ? "budget" : "rate_limited",
      });
      return done(template, "template");
    }

    // Only amounts and component names go to the model. No names, ids or bank details.
    const prompt = `Explain this Indian payslip to the employee in ${lang === "hi" ? "simple Hindi (Devanagari)" : "simple English"}. Use only these facts and amounts; never invent numbers. Reply as JSON {"summary": string, "points": string[]}.\n${JSON.stringify(
      {
        month: facts.monthLabel,
        gross: facts.gross / 100,
        deductions: facts.deductions / 100,
        net: facts.net / 100,
        earnings: facts.earnings.map((l) => ({ name: l.name, rupees: l.amount / 100 })),
        deductionLines: facts.deductionLines.map((l) => ({ name: l.name, rupees: l.amount / 100 })),
        lopDays: facts.lopDays,
      },
    )}\nWrite amounts as ₹ with Indian digit grouping.`;
    try {
      const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      const res = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: prompt,
        config: { temperature: 0.2, maxOutputTokens: 900, responseMimeType: "application/json" },
      });
      const parsed = explanationSchema.parse(JSON.parse(res.text ?? ""));
      if (!figuresAreGrounded(`${parsed.summary} ${parsed.points.join(" ")}`, facts))
        throw new Error("ungrounded figures");
      await logUsage(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        feature: "explainer",
        model: env.GEMINI_MODEL,
        inputTokens: res.usageMetadata?.promptTokenCount ?? estimateTokens(prompt),
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? estimateTokens(res.text ?? ""),
        status: "ok",
      });
      return done(parsed, "model");
    } catch {
      await logUsage(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        feature: "explainer",
        model: env.GEMINI_MODEL,
        inputTokens: estimateTokens(prompt),
        outputTokens: 0,
        status: "fallback",
      });
      return done(template, "template");
    }
  });
}
