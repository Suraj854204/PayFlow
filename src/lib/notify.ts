import "server-only";
import type { Tx } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export interface NotifyInput {
  userId: string | null | undefined;
  type: string;
  title: string;
  body?: string;
  href?: string;
}

/** In-app notification inside the caller's transaction. Silently skips people without a login. */
export async function notify(tx: Tx, organizationId: string, n: NotifyInput) {
  if (!n.userId) return;
  await tx.insert(notifications).values({
    organizationId,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
  });
}
