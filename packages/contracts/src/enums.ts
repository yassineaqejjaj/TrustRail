/**
 * Shared enums for TrustRail. Kept as plain string unions (not TS `enum`)
 * so they serialize identically across the API, SDKs, and the Python SDK's
 * mirrored constants.
 */

export const ROLES = ["owner", "admin", "operator", "approver", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * V1 fully implements the "sandbox" environment only. "production" is a
 * recognized value in the schema (agents/grants/policies are scoped by
 * environment) but no live payment connector exists — see
 * docs/PRODUCT_SPEC.md Future scope. Do not route real money through it.
 */
export const ENVIRONMENTS = ["sandbox", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const AGENT_STATUSES = ["active", "disabled", "revoked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const CREDENTIAL_STATUSES = ["active", "rotated", "revoked", "expired"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const GRANT_STATUSES = ["active", "revoked", "expired"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const ISSUER_TYPES = ["user", "agent"] as const;
export type IssuerType = (typeof ISSUER_TYPES)[number];

export const POLICY_VERSION_STATUSES = ["draft", "published", "superseded"] as const;
export type PolicyVersionStatus = (typeof POLICY_VERSION_STATUSES)[number];

export const DECISIONS = ["ALLOW", "DENY", "REQUIRE_APPROVAL"] as const;
export type Decision = (typeof DECISIONS)[number];

export const EXECUTION_STATES = [
  "received",
  "awaiting_approval",
  "ready",
  "reserved",
  "dispatching",
  "succeeded",
  "failed",
  "unknown",
  "denied",
  "cancelled",
  "expired",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

/**
 * Legal execution-state transitions. Enforced in
 * packages/policy-engine/src/lifecycle.ts and unit-tested directly —
 * this table is the single source of truth referenced by that code.
 */
export const EXECUTION_STATE_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  received: ["ready", "awaiting_approval", "denied", "expired"],
  awaiting_approval: ["ready", "denied", "expired", "cancelled"],
  ready: ["reserved", "denied", "expired"],
  reserved: ["dispatching", "failed", "expired"],
  dispatching: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  denied: [],
  cancelled: [],
  expired: [],
};

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RECEIPT_TYPES = ["decision", "execution"] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

export const REASON_CODES = [
  "GRANT_REVOKED",
  "GRANT_EXPIRED",
  "GRANT_NOT_FOUND",
  "SCOPE_MISMATCH",
  "DELEGATION_WIDENING",
  "DELEGATION_NOT_ALLOWED",
  "DELEGATION_DEPTH_EXCEEDED",
  "AMOUNT_LIMIT",
  "BUDGET_EXCEEDED",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "APPROVAL_REJECTED",
  "RESOURCE_MISMATCH",
  "STATE_UNAVAILABLE",
  "CONNECTOR_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "POLICY_UNAVAILABLE",
  "CREDENTIAL_REVOKED",
  "INTERNAL_ERROR",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const CURRENCIES = ["EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ACTIONS = ["refund.create"] as const;
export type ActionName = (typeof ACTIONS)[number];
