import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { grants } from "../db/schema.js";
import type { GrantChainLink } from "@trustrail/policy-engine";
import type { ActionName, Currency } from "@trustrail/contracts";

function toChainLink(row: typeof grants.$inferSelect): GrantChainLink {
  return {
    id: row.id,
    organizationId: row.organizationId,
    environment: row.environment,
    parentGrantId: row.parentGrantId,
    rootGrantId: row.rootGrantId,
    principalId: row.principalId,
    subjectAgentId: row.subjectAgentId,
    allowedActions: row.allowedActions as ActionName[],
    allowedResourceIds: row.allowedResourceIds as string[],
    unrestrictedResources: row.unrestrictedResources,
    allowedConnectorIds: row.allowedConnectorIds as string[],
    currency: row.currency as Currency,
    maxAmountMinor: row.maxAmountMinor,
    rootBudgetLimitMinor: row.rootBudgetLimitMinor,
    childBudgetLimitMinor: row.childBudgetLimitMinor,
    validFrom: row.validFrom?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    delegationAllowed: row.delegationAllowed,
    maxRemainingDepth: row.maxRemainingDepth,
    status: row.status as "active" | "revoked" | "expired",
  };
}

/**
 * Walks parent_grant_id up to the root and returns the chain ordered
 * root -> leaf, re-reading every grant fresh from the database (never
 * cached) so a revocation that just committed is always visible to the
 * very next evaluation -- see docs/PRODUCT_SPEC.md section 5 ("V1 uses
 * online grant lookup on every dispatch").
 */
export async function resolveGrantChain(db: Db, organizationId: string, leafGrantId: string): Promise<GrantChainLink[] | null> {
  const chain: GrantChainLink[] = [];
  let currentId: string | null = leafGrantId;
  const seen = new Set<string>();

  while (currentId) {
    if (seen.has(currentId)) return null; // cycle
    seen.add(currentId);
    const rows: Array<typeof grants.$inferSelect> = await db.select().from(grants).where(eq(grants.id, currentId)).limit(1);
    const row: typeof grants.$inferSelect | undefined = rows[0];
    if (!row || row.organizationId !== organizationId) return null;
    chain.unshift(toChainLink(row));
    currentId = row.parentGrantId;
    if (chain.length > 10) return null; // defensive bound, well above GRANT_MAX_CHAIN_DEPTH
  }
  return chain;
}
