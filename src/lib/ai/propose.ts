import "server-only";
import { aiActions, type AiActionKind } from "@/lib/db/schema";
import { ACTION_TTL_MS, ACTIONS, type Proposal } from "./actions";
import type { ToolEnv, ToolResult } from "./tools";

/**
 * Saves a proposal and returns the card to show. The model is told plainly that nothing has
 * happened yet, so it cannot claim an action was done.
 */
export async function storeProposal(
  env: ToolEnv,
  kind: AiActionKind,
  p: Proposal,
): Promise<ToolResult> {
  if (!p.ok) return { data: { proposed: false, reason: p.error } };
  const def = ACTIONS[kind];
  const expiresAt = new Date(Date.now() + ACTION_TTL_MS);
  const row = await env.db(async (tx) => {
    const [r] = await tx
      .insert(aiActions)
      .values({
        organizationId: env.ctx.organizationId,
        userId: env.ctx.user.id,
        sessionId: env.sessionId ?? null,
        kind,
        params: p.params,
        preview: p.preview,
        destructive: def.destructive ? 1 : 0,
        expiresAt,
      })
      .returning({ id: aiActions.id });
    return r;
  });
  return {
    data: {
      proposed: true,
      summary: p.preview.summary,
      note: "A confirmation card is now shown to the user. NOTHING has changed yet. Tell the user to review the card and confirm; never say it is done.",
    },
    action: {
      id: row.id,
      kind,
      title: p.preview.title,
      summary: p.preview.summary,
      changes: p.preview.changes,
      warnings: p.preview.warnings,
      destructive: def.destructive,
      status: "pending",
      expiresAt: expiresAt.toISOString(),
    },
  };
}
