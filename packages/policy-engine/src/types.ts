import type { ActionName, Currency, Decision, PolicyBundle, ReasonCode } from "@trustrail/contracts";

export interface GrantChainLink {
  id: string;
  organizationId: string;
  environment: string;
  parentGrantId: string | null;
  rootGrantId: string;
  principalId: string;
  subjectAgentId: string;
  allowedActions: ActionName[];
  allowedResourceIds: string[];
  unrestrictedResources: boolean;
  allowedConnectorIds: string[];
  currency: Currency;
  maxAmountMinor: number;
  validFrom: string | null; // ISO
  expiresAt: string | null; // ISO
  delegationAllowed: boolean;
  maxRemainingDepth: number;
  status: "active" | "revoked" | "expired";
}

export interface OrderFacts {
  found: boolean;
  ownedByPrincipal: boolean;
  ageDays: number;
  disputed: boolean;
  remainingAmountMinor: number;
  currency: Currency;
}

export interface EvaluationRequest {
  now: Date;
  action: ActionName;
  resourceId: string;
  connectorId: string;
  amountMinor: number;
  currency: Currency;
  /** Ordered root -> leaf. Last element is the grant the caller presented. */
  chain: GrantChainLink[];
  order: OrderFacts | { found: false };
  policy: PolicyBundle | null;
  /**
   * When resuming after a human decision, the caller passes the approval
   * outcome so evaluate() can turn REQUIRE_APPROVAL into ALLOW/DENY instead
   * of asking again. Absent on the first pass.
   */
  approval?: {
    status: "pending" | "approved" | "rejected" | "expired";
  };
}

export interface EvaluationResult {
  decision: Decision;
  reasonCodes: ReasonCode[];
  explanation: string;
  matchedChecks: string[];
  evaluatedValues: Record<string, unknown>;
}
