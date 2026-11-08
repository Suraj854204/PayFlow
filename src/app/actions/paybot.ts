"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/action";
import { runAction } from "@/lib/action-runner";
import { aiActions, chatMessages, chatSessions } from "@/lib/db/schema";
import type { ActionCard } from "@/lib/ai/types";
import { inArray } from "drizzle-orm";

const uuid = z.string().uuid();

export async function listChatsAction() {
  return runAction("ai:use", async ({ ctx, tx }) => {
    const rows = await tx
      .select({ id: chatSessions.id, title: chatSessions.title, at: chatSessions.updatedAt })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.organizationId, ctx.organizationId),
          eq(chatSessions.userId, ctx.user.id),
        ),
      )
      .orderBy(desc(chatSessions.updatedAt))
      .limit(20);
    return rows.map((r) => ({ id: r.id, title: r.title, at: r.at.toISOString() }));
  });
}

/** Messages of one of the caller's own conversations. Someone else's id returns "not found". */
export async function loadChatAction(id: string) {
  return runAction("ai:use", async ({ ctx, tx }) => {
    const sid = uuid.parse(id);
    const [s] = await tx
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sid), eq(chatSessions.userId, ctx.user.id)));
    if (!s) throw new UserFacingError("Conversation not found.");
    const rows = await tx
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sid))
      .orderBy(chatMessages.createdAt);
    const ids = rows.map((m) => m.actionId).filter((x): x is string => Boolean(x));
    const cards = new Map<string, ActionCard>();
    if (ids.length) {
      const acts = await tx
        .select()
        .from(aiActions)
        .where(and(inArray(aiActions.id, ids), eq(aiActions.userId, ctx.user.id)));
      for (const a of acts) {
        const lapsed = a.status === "pending" && a.expiresAt.getTime() < Date.now();
        cards.set(a.id, {
          id: a.id,
          kind: a.kind,
          title: a.preview.title,
          summary: a.preview.summary,
          changes: a.preview.changes,
          warnings: a.preview.warnings,
          destructive: a.destructive === 1,
          status: lapsed ? "expired" : a.status,
          expiresAt: a.expiresAt.toISOString(),
          result: a.result,
        });
      }
    }
    return rows.map((m) => ({
      action: m.actionId ? (cards.get(m.actionId) ?? null) : null,
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      sources: m.sources,
      chart: m.chart,
      feedback: m.feedback,
      engine: m.engine,
    }));
  });
}

export async function deleteChatAction(id: string) {
  return runAction("ai:use", async ({ ctx, tx }) => {
    const del = await tx
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, uuid.parse(id)), eq(chatSessions.userId, ctx.user.id)))
      .returning({ id: chatSessions.id });
    if (del.length === 0) throw new UserFacingError("Conversation not found.");
    return null;
  });
}

/** Thumbs up (1), down (-1) or clear (0) on an assistant reply in the caller's own conversation. */
export async function feedbackAction(input: unknown) {
  return runAction("ai:use", async ({ ctx, tx }) => {
    const d = z
      .object({ messageId: uuid, value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) })
      .parse(input);
    const [m] = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatSessions.id, chatMessages.sessionId))
      .where(
        and(
          eq(chatMessages.id, d.messageId),
          eq(chatSessions.userId, ctx.user.id),
          eq(chatMessages.role, "assistant"),
        ),
      );
    if (!m) throw new UserFacingError("Message not found.");
    await tx
      .update(chatMessages)
      .set({ feedback: d.value === 0 ? null : d.value })
      .where(eq(chatMessages.id, d.messageId));
    return null;
  });
}
