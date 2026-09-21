import type { ReasonCode } from "@trustrail/contracts";
import { effectiveMaxAmountMinor, validateChain } from "./chain.js";
import type { EvaluationRequest, EvaluationResult } from "./types.js";

/**
 * Implements the evaluation sequence from docs/PRODUCT_SPEC.md section 6,
 * steps 2-6 (step 1 -- authn/schema/env/tenant -- happens before this
 * function is called, at the HTTP layer; step 7 -- atomic budget
 * reservation -- happens after, in the gateway, because it requires a
 * database transaction this pure function does not have access to).
 *
 * Precedence is DENY, then REQUIRE_APPROVAL, then ALLOW. Any inability to
 * evaluate (missing policy, unavailable order state, connector mismatch)
 * fails closed as DENY with a specific reason code -- never ALLOW.
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
  if (leaf.currency !== req.currency) {
    return deny(["SCOPE_MISMATCH"], "Currency does not match the grant.", matchedChecks, evaluatedValues);
  }
  matchedChecks.push("scope_ok");

  const effectiveCap = effectiveMaxAmountMinor(req.chain);
  evaluatedValues.effective_grant_cap_minor = effectiveCap;
  if (req.amountMinor > effectiveCap) {
    return deny(["AMOUNT_LIMIT"], "Amount exceeds the delegation chain's effective cap.", matchedChecks, evaluatedValues);
  }
  matchedChecks.push("grant_cap_ok");

  // Step 4: authoritative order/payment facts from the trusted connector.
  if (!req.order.found) {
    return deny(["STATE_UNAVAILABLE"], "Order/payment state could not be retrieved from the connector.", matchedChecks, evaluatedValues);
  }
  const order = req.order;
  evaluatedValues.order_age_days = order.ageDays;
  evaluatedValues.order_disputed = order.disputed;
  evaluatedValues.order_remaining_amount_minor = order.remainingAmountMinor;

  if (order.currency !== req.currency) {
    return deny(["SCOPE_MISMATCH"], "Order currency does not match the request.", matchedChecks, evaluatedValues);
  }

  // Step 5: hard policy conditions and caps.
  if (!req.policy) {
    return deny(["POLICY_UNAVAILABLE"], "No published policy is available for this action/environment.", matchedChecks, evaluatedValues);
  }
  const policy = req.policy;
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

  if (req.amountMinor > policy.approval_limit_minor) {
    return deny(["AMOUNT_LIMIT"], "Amount exceeds the policy's hard approval ceiling.", matchedChecks, evaluatedValues);
  }

  // Step 6: determine whether human approval is required.
  const requiresApproval = req.amountMinor > policy.automatic_limit_minor;
  matchedChecks.push(requiresApproval ? "approval_tier" : "automatic_tier");

  if (!requiresApproval) {
    return {
      decision: "ALLOW",
      reasonCodes: [],
      explanation: `Amount is within the automatic limit of ${policy.automatic_limit_minor} minor units.`,
      matchedChecks,
      evaluatedValues,
    };
  }

  if (!req.approval) {
    return {
      decision: "REQUIRE_APPROVAL",
      reasonCodes: ["APPROVAL_REQUIRED"],
      explanation: `Amount exceeds the automatic limit; human approval is required (up to ${policy.approval_limit_minor} minor units).`,
      matchedChecks,
      evaluatedValues,
    };
  }

  if (req.approval.status === "approved") {
    return {
      decision: "ALLOW",
      reasonCodes: [],
      explanation: "Approved by an authorized reviewer for this exact request.",
      matchedChecks: [...matchedChecks, "approval_granted"],
      evaluatedValues,
    };
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

function deny(
  reasonCodes: ReasonCode[],
  explanation: string,
  matchedChecks: string[],
  evaluatedValues: Record<string, unknown>
): EvaluationResult {
  return { decision: "DENY", reasonCodes, explanation, matchedChecks, evaluatedValues };
}
