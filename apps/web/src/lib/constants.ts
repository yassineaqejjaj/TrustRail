/**
 * Small value constants mirrored from @trustrail/contracts.
 *
 * Why duplicate instead of importing the real values: @trustrail/contracts
 * is a single barrel export (`packages/contracts/src/index.ts`) that
 * includes `canonical.ts`, which imports `node:crypto` for
 * `canonicalHash`/`sha256Hex`. That's fine for the API (a Node process) but
 * webpack cannot bundle a `node:crypto` import into a browser bundle, so
 * any *value* import from "@trustrail/contracts" (not just types) drags the
 * whole barrel — including canonical.ts — into the client build and fails
 * with `UnhandledSchemeError: node:crypto`. Since packages/contracts is
 * finished/tested code we must not modify (see docs/BUILD_STATUS.md), the
 * pragmatic fix on the frontend side is: import *types* from
 * "@trustrail/contracts" freely (erased at compile time, never bundled),
 * but keep small, stable runtime value arrays/objects duplicated here.
 * These are checked against packages/contracts/src/enums.ts and policy.ts
 * and must be kept in sync if those ever change.
 */
import type { ActionName, Decision, Environment, ExecutionState, PolicyBundle, Role } from "@trustrail/contracts";

export const ROLES: readonly Role[] = ["owner", "admin", "operator", "approver", "viewer"];

export const ENVIRONMENTS: readonly Environment[] = ["sandbox", "production"];

export const DECISIONS: readonly Decision[] = ["ALLOW", "DENY", "REQUIRE_APPROVAL"];

export const EXECUTION_STATES: readonly ExecutionState[] = [
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
];

export const ACTIONS: readonly ActionName[] = [
  "refund.create",
  "subscription.grant_credit",
  "subscription.change_plan",
  "subscription.activate_feature",
  "subscription.invite_user",
];

export const DEFAULT_POLICY_BUNDLE: PolicyBundle = {
  schema_version: "1",
  action: "refund.create",
  currency: "EUR",
  automatic_limit_minor: 10_000,
  approval_limit_minor: 50_000,
  root_daily_limit_minor: 100_000,
  require_original_payment_destination: true,
  require_order_ownership: true,
  max_order_age_days: 30,
  deny_if_payment_disputed: true,
  approval_ttl_seconds: 900,
};

export const DEFAULT_GRANT_CREDIT_POLICY_BUNDLE: PolicyBundle = {
  schema_version: "1",
  action: "subscription.grant_credit",
  currency: "EUR",
  automatic_limit_minor: 15_000,
  approval_limit_minor: 50_000,
  root_daily_limit_minor: 100_000,
  approval_ttl_seconds: 900,
};

export const DEFAULT_CHANGE_PLAN_POLICY_BUNDLE: PolicyBundle = {
  schema_version: "1",
  action: "subscription.change_plan",
  currency: "EUR",
  root_daily_limit_minor: 20,
  approval_ttl_seconds: 900,
  eligible_target_plans: ["starter", "growth", "scale"],
  require_approval_for_downgrade: true,
};

export const DEFAULT_ACTIVATE_FEATURE_POLICY_BUNDLE: PolicyBundle = {
  schema_version: "1",
  action: "subscription.activate_feature",
  currency: "EUR",
  root_daily_limit_minor: 50,
  approval_ttl_seconds: 900,
  allowed_feature_keys: ["sso", "advanced_reporting", "api_access", "custom_roles"],
};

export const DEFAULT_INVITE_USER_POLICY_BUNDLE: PolicyBundle = {
  schema_version: "1",
  action: "subscription.invite_user",
  currency: "EUR",
  root_daily_limit_minor: 30,
  approval_ttl_seconds: 900,
  allowed_roles: ["member", "billing", "viewer"],
  disallow_admin_role: true,
};

export const DEFAULT_POLICY_BUNDLES_BY_ACTION: Record<ActionName, PolicyBundle> = {
  "refund.create": DEFAULT_POLICY_BUNDLE,
  "subscription.grant_credit": DEFAULT_GRANT_CREDIT_POLICY_BUNDLE,
  "subscription.change_plan": DEFAULT_CHANGE_PLAN_POLICY_BUNDLE,
  "subscription.activate_feature": DEFAULT_ACTIVATE_FEATURE_POLICY_BUNDLE,
  "subscription.invite_user": DEFAULT_INVITE_USER_POLICY_BUNDLE,
};
