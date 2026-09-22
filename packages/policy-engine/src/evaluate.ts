import { isMoneyAction, type ReasonCode } from "@trustrail/contracts";
import { effectiveMaxAmountMinor, validateChain } from "./chain.js";
import type { EvaluationRequest, EvaluationResult, OrderFacts, SubscriptionAccountFacts } from "./types.js";

/**
 * Implements the evaluation sequence from docs/PRODUCT_SPEC.md section 6,
 * steps 2-6 (step 1 -- authn/schema/env/tenant -- happens before this
 * function is called, at the HTTP layer; step 7 -- atomic budget
 * reservation -- happens after, in the gateway, because it requires a
 * database transaction this pure function does not have access to).
 *
 * Precedence is DENY, then REQUIRE_APPROVAL, then ALLOW. Any inability to
 * evaluate (missing policy, unavailable resource state, connector
 * mismatch) fails closed as DENY with a specific reason code -- never
 * ALLOW.
 *
 * Steps 2/3 (delegation chain + grant scope) are identical for every
 * action -- a grant's allowed actions/resources/connector and its amount
 * cap (skipped entirely for non-money actions, see isMoneyAction) are
 * checked the same way regardless of what's being dispatched. Steps 4-6
 * (resource facts, hard conditions, approval tiering) branch by action:
 * `refund.create` keeps its original order-facts logic; every
 * `subscription.*` action shares one SaaS-account-facts evaluator.
 */
export function evaluate(req: EvaluationRequest): EvaluationResult {
  const matchedChecks: string[] = [];
  const evaluatedValues: Record<string, unknown> = {
    amount_minor: req.amountMinor,
    currency: req.currency,
    action: req.action,
    resource_id: req.resourceId,
  };

  // Step 2/3: resolve and validate the grant chain.
  const chainResult = validateChain(req.chain, req.now);
  if (!chainResult.ok) {
    return deny(chainResult.reasonCodes, "Delegation chain failed validation.", matchedChecks, evaluatedValues);
  }
  matchedChecks.push("chain_valid");

  const leaf = req.chain[req.chain.length - 1]!;

  if (!leaf.allowedActions.includes(req.action)) {
    return deny(["SCOPE_MISMATCH"], "Action is not permitted by the grant.", matchedChecks, evaluatedValues);
  }
  if (!leaf.allowedConnectorIds.includes(req.connectorId)) {
    return deny(["SCOPE_MISMATCH"], "Connector is not permitted by the grant.", matchedChecks, evaluatedValues);
  }
  if (!leaf.unrestrictedResources && !leaf.allowedResourceIds.includes(req.resourceId)) {
    return deny(["RESOURCE_MISMATCH"], "Resource is not permitted by the grant.", matchedChecks, evaluatedValues);
  }

  const moneyAction = isMoneyAction(req.action);
  if (moneyAction) {
    if (leaf.currency !== req.currency) {
      return deny(["SCOPE_MISMATCH"], "Currency does not match the grant.", matchedChecks, evaluatedValues);
    }
    const effectiveCap = effectiveMaxAmountMinor(req.chain);
    evaluatedValues.effective_grant_cap_minor = effectiveCap;
    if (req.amountMinor > effectiveCap) {
      return deny(["AMOUNT_LIMIT"], "Amount exceeds the delegation chain's effective cap.", matchedChecks, evaluatedValues);
    }
  }
  matchedChecks.push("scope_ok");

  if (!req.policy) {
    return deny(["POLICY_UNAVAILABLE"], "No published policy is available for this action/environment.", matchedChecks, evaluatedValues);
  }

  if (req.action === "refund.create") {
    return evaluateRefund(req, matchedChecks, evaluatedValues);
  }
  return evaluateSubscriptionAction(req, matchedChecks, evaluatedValues);
}

function evaluateRefund(req: EvaluationRequest, matchedChecks: string[], evaluatedValues: Record<string, unknown>): EvaluationResult {
  // Step 4: authoritative order/payment facts from the trusted connector.
  if (!req.resource.found) {
    return deny(["STATE_UNAVAILABLE"], "Order/payment state could not be retrieved from the connector.", matchedChecks, evaluatedValues);
  }
  const order = req.resource as OrderFacts;
  evaluatedValues.order_age_days = order.ageDays;
  evaluatedValues.order_disputed = order.disputed;
  evaluatedValues.order_remaining_amount_minor = order.remainingAmountMinor;

  if (order.currency !== req.currency) {
    return deny(["SCOPE_MISMATCH"], "Order currency does not match the request.", matchedChecks, evaluatedValues);
  }

  // Step 5: hard policy conditions and caps.
  const policy = req.policy;
  if (policy?.action !== "refund.create") {
    return deny(["POLICY_UNAVAILABLE"], "Published policy does not match this action.", matchedChecks, evaluatedValues);
  }
  evaluatedValues.policy = {
    automatic_limit_minor: policy.automatic_limit_minor,
    approval_limit_minor: policy.approval_limit_minor,
    root_daily_limit_minor: policy.root_daily_limit_minor,
  };

  if (policy.currency !== req.currency) {
    return deny(["SCOPE_MISMATCH"], "Policy currency does not match the request.", matchedChecks, evaluatedValues);
  }
  if (policy.require_order_ownership && !order.ownedByPrincipal) {
    return deny(["RESOURCE_MISMATCH"], "Order is not owned by the accountable principal.", matchedChecks, evaluatedValues);
  }
  if (policy.max_order_age_days != null && order.ageDays > policy.max_order_age_days) {
    return deny(["STATE_UNAVAILABLE"], "Order exceeds the maximum age allowed by policy.", matchedChecks, evaluatedValues);
  }
  if (policy.deny_if_payment_disputed && order.disputed) {
    return deny(["STATE_UNAVAILABLE"], "Payment is disputed; policy denies refunds on disputed payments.", matchedChecks, evaluatedValues);
  }
  if (req.amountMinor > order.remainingAmountMinor) {
    return deny(["AMOUNT_LIMIT"], "Amount exceeds the remaining refundable balance on the order.", matchedChecks, evaluatedValues);
  }
  matchedChecks.push("hard_conditions_ok");

  return decideAmountTier(req, policy.automatic_limit_minor, policy.approval_limit_minor, matchedChecks, evaluatedValues);
}

/**
 * All four `subscription.*` actions share one resource (a SaaS account)
 * and one policy-lookup pattern, but differ in what they check beyond
 * that shared shape:
 * - grant_credit reuses the money automatic/approval tiering.
 * - change_plan/activate_feature/invite_user are allow-list gates, none
 *   of them using amount tiering at all (see PLAN_NOT_ELIGIBLE,
 *   FEATURE_NOT_ALLOWED, ROLE_NOT_ALLOWED below) -- a deliberate example
 *   that not every action needs a three-tier system.
 */
function evaluateSubscriptionAction(req: EvaluationRequest, matchedChecks: string[], evaluatedValues: Record<string, unknown>): EvaluationResult {
  if (!req.resource.found) {
    return deny(["STATE_UNAVAILABLE"], "Account state could not be retrieved from the connector.", matchedChecks, evaluatedValues);
  }
  const account = req.resource as SubscriptionAccountFacts;
  evaluatedValues.account_suspended = account.suspended;
  evaluatedValues.account_plan = account.currentPlanId;

  if (account.suspended) {
    return deny(["STATE_UNAVAILABLE"], "The account is suspended.", matchedChecks, evaluatedValues);
  }

  const policy = req.policy!;
  matchedChecks.push("hard_conditions_ok");
  const args = req.arguments ?? {};

  if (req.action === "subscription.grant_credit") {
    if (policy.action !== "subscription.grant_credit") {
      return deny(["POLICY_UNAVAILABLE"], "Published policy does not match this action.", matchedChecks, evaluatedValues);
    }
    return decideAmountTier(req, policy.automatic_limit_minor, policy.approval_limit_minor, matchedChecks, evaluatedValues);
  }

  if (req.action === "subscription.change_plan") {
    if (policy.action !== "subscription.change_plan") {
      return deny(["POLICY_UNAVAILABLE"], "Published policy does not match this action.", matchedChecks, evaluatedValues);
    }
    const targetPlan = String(args.target_plan ?? "");
    evaluatedValues.target_plan = targetPlan;
    if (!policy.eligible_target_plans.includes(targetPlan)) {
      return deny(["PLAN_NOT_ELIGIBLE"], `"${targetPlan}" is not an eligible target plan.`, matchedChecks, evaluatedValues);
    }
    const isDowngrade = isPlanDowngrade(account.currentPlanId, targetPlan);
    evaluatedValues.is_downgrade = isDowngrade;
    if (isDowngrade && policy.require_approval_for_downgrade) {
      return decideApprovalOutcome(req, "Downgrading to a lower plan requires human approval.", matchedChecks, evaluatedValues);
    }
    return allow("Target plan is eligible and does not require approval.", matchedChecks, evaluatedValues);
  }

  if (req.action === "subscription.activate_feature") {
    if (policy.action !== "subscription.activate_feature") {
      return deny(["POLICY_UNAVAILABLE"], "Published policy does not match this action.", matchedChecks, evaluatedValues);
    }
    const featureKey = String(args.feature_key ?? "");
    evaluatedValues.feature_key = featureKey;
    if (!policy.allowed_feature_keys.includes(featureKey)) {
      return deny(["FEATURE_NOT_ALLOWED"], `"${featureKey}" is not an allowed feature.`, matchedChecks, evaluatedValues);
    }
    return allow("Feature is on the allowed list.", matchedChecks, evaluatedValues);
  }

  // subscription.invite_user
  if (policy.action !== "subscription.invite_user") {
    return deny(["POLICY_UNAVAILABLE"], "Published policy does not match this action.", matchedChecks, evaluatedValues);
  }
  const role = String(args.role ?? "");
  evaluatedValues.invited_role = role;
  if (policy.disallow_admin_role && role === "admin") {
    return deny(["ROLE_NOT_ALLOWED"], "Admin role cannot be granted by an agent, no exceptions.", matchedChecks, evaluatedValues);
  }
  if (!policy.allowed_roles.includes(role)) {
    return decideApprovalOutcome(req, `Role "${role}" is outside the normally allowed set; treating as an exception.`, matchedChecks, evaluatedValues);
  }
  return allow("Role is on the allowed list.", matchedChecks, evaluatedValues);
}

/** A plan lower in this fixed ordering than the current one counts as a downgrade; an unknown current plan is never treated as a downgrade. */
const PLAN_RANK: Record<string, number> = { starter: 0, growth: 1, scale: 2, enterprise: 3 };
function isPlanDowngrade(currentPlanId: string, targetPlanId: string): boolean {
  const currentRank = PLAN_RANK[currentPlanId];
  const targetRank = PLAN_RANK[targetPlanId];
  if (currentRank == null || targetRank == null) return false;
  return targetRank < currentRank;
}

function decideAmountTier(
  req: EvaluationRequest,
  automaticLimitMinor: number,
  approvalLimitMinor: number,
  matchedChecks: string[],
  evaluatedValues: Record<string, unknown>
): EvaluationResult {
  if (req.amountMinor > approvalLimitMinor) {
    return deny(["AMOUNT_LIMIT"], "Amount exceeds the policy's hard approval ceiling.", matchedChecks, evaluatedValues);
  }
  const requiresApproval = req.amountMinor > automaticLimitMinor;
  matchedChecks.push(requiresApproval ? "approval_tier" : "automatic_tier");
  if (!requiresApproval) {
    return allow(`Amount is within the automatic limit of ${automaticLimitMinor} minor units.`, matchedChecks, evaluatedValues);
  }
  return decideApprovalOutcome(req, `Amount exceeds the automatic limit; human approval is required (up to ${approvalLimitMinor} minor units).`, matchedChecks, evaluatedValues);
}

/** Step 6: determine whether human approval is required, or resolve a pending one's outcome. */
function decideApprovalOutcome(
  req: EvaluationRequest,
  requireApprovalExplanation: string,
  matchedChecks: string[],
  evaluatedValues: Record<string, unknown>
): EvaluationResult {
  if (!req.approval) {
    return {
      decision: "REQUIRE_APPROVAL",
      reasonCodes: ["APPROVAL_REQUIRED"],
      explanation: requireApprovalExplanation,
      matchedChecks,
      evaluatedValues,
    };
  }
  if (req.approval.status === "approved") {
    return allow("Approved by an authorized reviewer for this exact request.", [...matchedChecks, "approval_granted"], evaluatedValues);
  }
  if (req.approval.status === "rejected") {
    return deny(["APPROVAL_REJECTED"], "The reviewer rejected this request.", matchedChecks, evaluatedValues);
  }
  if (req.approval.status === "expired") {
    return deny(["APPROVAL_EXPIRED"], "The approval window expired before a decision was recorded.", matchedChecks, evaluatedValues);
  }
  return {
    decision: "REQUIRE_APPROVAL",
    reasonCodes: ["APPROVAL_REQUIRED"],
    explanation: "Awaiting reviewer decision.",
    matchedChecks,
    evaluatedValues,
  };
}

function allow(explanation: string, matchedChecks: string[], evaluatedValues: Record<string, unknown>): EvaluationResult {
  return { decision: "ALLOW", reasonCodes: [], explanation, matchedChecks, evaluatedValues };
}

function deny(
  reasonCodes: ReasonCode[],
  explanation: string,
  matchedChecks: string[],
  evaluatedValues: Record<string, unknown>
): EvaluationResult {
  return { decision: "DENY", reasonCodes, explanation, matchedChecks, evaluatedValues };
}
