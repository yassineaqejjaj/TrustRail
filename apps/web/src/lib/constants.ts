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

export const ACTIONS: readonly ActionName[] = ["refund.create"];

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
