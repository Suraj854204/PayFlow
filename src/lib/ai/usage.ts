import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { estimateCostMicroUsd } from "./guard";

export type UsageStatus = "ok" | "fallback" | "error" | "blocked" | "rate_limited" | "budget";

export async function logUsage(
  tx: Tx,
  e: {
    organizationId: string;
    userId: string;
    feature: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    status: UsageStatus;
  },
) {
  await tx.insert(aiUsage).values({
    ...e,
    costMicroUsd: estimateCostMicroUsd(e.inputTokens, e.outputTokens),
  });
}

/** Estimated tokens this user has spent since midnight IST, across every AI feature. */
export async function tokensUsedToday(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<number> {
  const startIst = new Date(
    `${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00+05:30`,
  );
  const [r] = await tx
    .select({ n: sql<string>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        eq(aiUsage.userId, userId),
        gte(aiUsage.createdAt, startIst),
      ),
    );
  return Number(r?.n ?? 0);
}
