import { and, eq } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { idempotencyRecords, actions } from "@trustrail/db";
import { newId } from "@trustrail/db";

export type IdempotencyCheck =
  | { kind: "new" }
  | { kind: "replay"; actionId: string }
  | { kind: "conflict" };

/**
 * "Same key and same payload returns the same action without a second
 * write. Same key with another payload returns 409." Uniqueness scope is
 * organization + authenticated actor + key (docs/PRODUCT_SPEC.md section
 * 7). The unique index on (organization_id, actor_agent_id, idempotency_key)
 * is the actual safety net under concurrency; this check is what lets us
 * return a clean 409 instead of a raw constraint-violation error when we
 * can tell in advance.
 */
export async function checkIdempotency(
  db: Db,
  organizationId: string,
  actorAgentId: string,
  idempotencyKey: string,
  payloadHash: string
): Promise<IdempotencyCheck> {
  const rows = await db
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.organizationId, organizationId),
        eq(idempotencyRecords.actorAgentId, actorAgentId),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { kind: "new" };
  if (row.payloadHash === payloadHash) return { kind: "replay", actionId: row.actionId };
  return { kind: "conflict" };
}

export async function recordIdempotencyKey(
  db: Db,
  organizationId: string,
  actorAgentId: string,
  idempotencyKey: string,
  payloadHash: string,
  actionId: string
): Promise<void> {
  await db.insert(idempotencyRecords).values({
    id: newId("idempotencyRecord"),
    organizationId,
    actorAgentId,
    idempotencyKey,
    payloadHash,
    actionId,
  });
}

export async function getAction(db: Db, actionId: string) {
  const rows = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  return rows[0] ?? null;
}
