import type { ReasonCode } from "@trustrail/contracts";
import type { GrantChainLink } from "./types.js";

export interface ChainValidation {
  ok: boolean;
  reasonCodes: ReasonCode[];
  failedGrantId?: string;
}

/**
 * Re-validates the entire delegation chain at evaluation time, from root to
 * leaf. This is deliberately redundant with the subset checks performed
 * when a child grant is *created* (packages/policy-engine is also used
 * there) -- ancestor revocation/expiry must invalidate descendants "at
 * execution time without requiring a background cascade to finish" per
 * docs/PRODUCT_SPEC.md section 5, so every dispatch re-walks the chain.
 */
export function validateChain(chain: GrantChainLink[], now: Date): ChainValidation {
  if (chain.length === 0) {
    return { ok: false, reasonCodes: ["GRANT_NOT_FOUND"] };
  }
  if (chain.length > 4) {
    // root + up to 3 delegation hops, per GRANT_MAX_CHAIN_DEPTH
    return { ok: false, reasonCodes: ["DELEGATION_DEPTH_EXCEEDED"], failedGrantId: chain[chain.length - 1]?.id };
  }

  const seen = new Set<string>();
  for (const link of chain) {
    if (seen.has(link.id)) {
      return { ok: false, reasonCodes: ["SCOPE_MISMATCH"], failedGrantId: link.id };
    }
    seen.add(link.id);
  }

  const rootId = chain[0]!.rootGrantId;
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i]!;
    const expectedParent = i === 0 ? null : chain[i - 1]!.id;

    if (link.rootGrantId !== rootId) {
      return { ok: false, reasonCodes: ["SCOPE_MISMATCH"], failedGrantId: link.id };
    }
    if (link.parentGrantId !== expectedParent) {
      return { ok: false, reasonCodes: ["SCOPE_MISMATCH"], failedGrantId: link.id };
    }
    if (link.status === "revoked") {
      return { ok: false, reasonCodes: ["GRANT_REVOKED"], failedGrantId: link.id };
    }
    if (link.status === "expired") {
      return { ok: false, reasonCodes: ["GRANT_EXPIRED"], failedGrantId: link.id };
    }
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) {
      return { ok: false, reasonCodes: ["GRANT_EXPIRED"], failedGrantId: link.id };
    }
    if (link.validFrom && new Date(link.validFrom).getTime() > now.getTime()) {
      return { ok: false, reasonCodes: ["GRANT_EXPIRED"], failedGrantId: link.id };
    }

    if (i > 0) {
      const parent = chain[i - 1]!;
      if (!parent.delegationAllowed) {
        return { ok: false, reasonCodes: ["DELEGATION_NOT_ALLOWED"], failedGrantId: link.id };
      }
      if (parent.maxRemainingDepth < 1) {
        return { ok: false, reasonCodes: ["DELEGATION_DEPTH_EXCEEDED"], failedGrantId: link.id };
      }

      const actionsSubset = link.allowedActions.every((a) => parent.allowedActions.includes(a));
      const resourcesSubset =
        parent.unrestrictedResources ||
        (!link.unrestrictedResources && link.allowedResourceIds.every((r) => parent.allowedResourceIds.includes(r)));
      const connectorsSubset = link.allowedConnectorIds.every((c) => parent.allowedConnectorIds.includes(c));
      const amountSubset = link.maxAmountMinor <= parent.maxAmountMinor;
      const currencyMatches = link.currency === parent.currency;
      const expirySubset =
        !parent.expiresAt || (!!link.expiresAt && new Date(link.expiresAt).getTime() <= new Date(parent.expiresAt).getTime());

      if (!actionsSubset || !resourcesSubset || !connectorsSubset || !amountSubset || !currencyMatches || !expirySubset) {
        return { ok: false, reasonCodes: ["DELEGATION_WIDENING"], failedGrantId: link.id };
      }
    }
  }

  return { ok: true, reasonCodes: [] };
}

/** Effective per-action cap for the leaf grant is the minimum across the whole chain. */
export function effectiveMaxAmountMinor(chain: GrantChainLink[]): number {
  return Math.min(...chain.map((g) => g.maxAmountMinor));
}
