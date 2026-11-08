import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db";
import { chatMessages, chatSessions, type ChatChart, type ChatSource } from "@/lib/db/schema";
import type { Turn } from "./types";

export const HISTORY_TURNS = 10;

export async function ensureSession(
  orgId: string,
  userId: string,
  sessionId: string | null | undefined,
  firstMessage: string,
): Promise<string | null> {
  return withTenant(orgId, async (tx) => {
    if (sessionId) {
      const [s] = await tx
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
      return s?.id ?? null;
    }
    const title = firstMessage.replace(/\s+/g, " ").slice(0, 60) || "New chat";
    const [s] = await tx
      .insert(chatSessions)
      .values({ organizationId: orgId, userId, title })
      .returning({ id: chatSessions.id });
    return s.id;
  });
}

/** The recent exchange, oldest first, as turns the model can continue from. */
export async function loadHistory(orgId: string, sessionId: string): Promise<Turn[]> {
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(HISTORY_TURNS),
  );
  return rows
    .reverse()
    .map((r): Turn =>
      r.role === "user"
        ? { role: "user", text: r.content }
        : { role: "model", text: r.content, calls: [] },
    );
}

export async function saveMessage(
  orgId: string,
  sessionId: string,
  m: {
    role: "user" | "assistant";
    content: string;
    sources?: ChatSource[];
    chart?: ChatChart | null;
    actionId?: string | null;
    engine?: string;
  },
): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .insert(chatMessages)
      .values({
        organizationId: orgId,
        sessionId,
        role: m.role,
        content: m.content,
        sources: m.sources ?? [],
        chart: m.chart ?? null,
        actionId: m.actionId ?? null,
        engine: m.engine ?? null,
      })
      .returning({ id: chatMessages.id });
    await tx
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
    return row.id;
  });
}
