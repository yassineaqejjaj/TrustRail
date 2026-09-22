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
  /** Only meaningful on the root grant (index 0 of the chain). */
  rootBudgetLimitMinor: number | null;
  /** Only meaningful on non-root grants; a sub-budget scoped to this grant and its descendants. */
  childBudgetLimitMinor: number | null;
  validFrom: string | null; // ISO
  expiresAt: string | null; // ISO
  delegationAllowed: boolean;
  maxRemainingDepth: number;
  status: "active" | "revoked" | "expired";
}

/** `refund.create`'s resource is the merchant order/payment being refunded. */
export interface OrderFacts {
  kind: "order";
  found: true;
  ownedByPrincipal: boolean;
  ageDays: number;
  disputed: boolean;
  remainingAmountMinor: number;
  currency: Currency;
}

/**
 * Every `subscription.*` action's resource is the same SaaS account --
 * grant_credit, change_plan, activate_feature, and invite_user all read
 * and mutate one account record, unlike refunds' one-resource-per-order
 * model. `currentPlanId`/`activeFeatureKeys`/`userCount`/`adminUserCount`
 * are read by different actions' policy checks (change_plan reads
 * `currentPlanId` for downgrade detection, invite_user reads nothing here
 * today but the shape is here for a future "max total users" policy).
 */
export interface SubscriptionAccountFacts {
  kind: "subscription_account";
  found: true;
  suspended: boolean;
  currentPlanId: string;
  activeFeatureKeys: string[];
  userCount: number;
  adminUserCount: number;
  currency: Currency;
}

export type ResourceFacts = OrderFacts | SubscriptionAccountFacts;

export interface EvaluationRequest {
  now: Date;
  action: ActionName;
  resourceId: string;
  connectorId: string;
  /**
   * Required for every action for a uniform request shape, but only
   * meaningful for money actions (isMoneyAction(action) from
   * @trustrail/contracts) -- the delegation chain's amount cap and the
   * policy's automatic/approval tiering are skipped entirely for
   * non-money actions, which are bounded by `arguments`-based allow-list
   * checks instead. Callers of non-money actions pass 0.
   */
  amountMinor: number;
  currency: Currency;
  /**
   * The full action-specific request arguments (e.g. `target_plan`,
   * `feature_key`, `role`) -- needed because non-money actions are
   * evaluated against fields evaluate() otherwise never sees (it only
   * unpacked `amountMinor`/`currency` from `arguments` before this
   * generalization). Optional because refund evaluation never reads it.
   */
  arguments?: Record<string, unknown>;
  /** Ordered root -> leaf. Last element is the grant the caller presented. */
  chain: GrantChainLink[];
  resource: ResourceFacts | { found: false };
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
