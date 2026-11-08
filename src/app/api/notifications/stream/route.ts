import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { getContext } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 4000;
const LIFETIME_MS = 270_000;

/**
 * Server-sent events for the bell. Each connection checks only its own user's rows every few
 * seconds (cheap, indexed) and pushes anything newer than the cursor. `Last-Event-ID` lets the
 * browser resume after the planned reconnect without missing or repeating anything.
 */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { organizationId: orgId } = ctx;
  const userId = ctx.user.id;

  const last = Number(req.headers.get("last-event-id"));
  let cursor = Number.isFinite(last) && last > 0 ? last : Date.now();
  const enc = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(enc.encode(chunk));
      send("retry: 3000\n\n");
      const poll = async () => {
        const [rows, [u]] = await withTenant(orgId, async (tx) => [
          await tx
            .select()
            .from(notifications)
            .where(
              and(
                eq(notifications.organizationId, orgId),
                eq(notifications.userId, userId),
                gt(notifications.createdAt, new Date(cursor)),
              ),
            )
            .orderBy(asc(notifications.createdAt))
            .limit(20),
          await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(notifications)
            .where(
              and(
                eq(notifications.organizationId, orgId),
                eq(notifications.userId, userId),
                isNull(notifications.readAt),
              ),
            ),
        ]);
        for (const n of rows) {
          cursor = Math.max(cursor, n.createdAt.getTime());
          send(
            `id: ${cursor}\nevent: notification\ndata: ${JSON.stringify({
              id: n.id,
              title: n.title,
              href: n.href,
              at: n.createdAt.toISOString(),
              unread: n.readAt === null,
              unreadCount: u?.n ?? 0,
            })}\n\n`,
          );
        }
        if (rows.length === 0) send(": keep-alive\n\n");
      };
      try {
        while (!req.signal.aborted && Date.now() - started < LIFETIME_MS) {
          await poll();
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch {
        // Fall through and close; the browser reconnects with Last-Event-ID.
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
