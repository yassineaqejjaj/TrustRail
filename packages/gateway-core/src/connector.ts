import type { ActionName } from "@trustrail/contracts";
import type { ResourceFacts } from "@trustrail/policy-engine";

/**
 * One implementation per downstream system (merchant sandbox, SaaS
 * sandbox, ...), registered by `connectorId` in a registry (see
 * `ConnectorRegistry` below) rather than a single hardcoded instance --
 * per docs/PRODUCT_SPEC.md section 12, connectors are configured by
 * trusted operators against an allowlist. There is no user-suppliable URL
 * or generic HTTP-forwarding capability anywhere in this codebase, which
 * is what keeps the gateway from being an SSRF endpoint.
 *
 * Generic across action types: `lookupResource`/`executeAction` take the
 * action name and pass `arguments` through opaquely, rather than a
 * refund-specific `amountMinor`/`currency` pair -- a connector interprets
 * `arguments` however its own action(s) need to.
 */
export interface Connector {
  readonly connectorId: string;
  /** A connector's resource shape doesn't depend on which action is being evaluated -- it always describes the resource itself (an order, an account, ...); see @trustrail/policy-engine's per-action evaluators for how the same facts are read differently depending on the action. */
  lookupResource(input: { organizationId: string; resourceId: string }): Promise<ResourceFacts | { found: false }>;
  executeAction(input: {
    organizationId: string;
    resourceId: string;
    action: ActionName;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<ActionOutcome>;
  /** `organizationId` is optional because not every connector's backing route needs it to scope the lookup (e.g. the merchant sandbox's idempotency keys are already globally unique). */
  lookupActionByIdempotencyKey(action: ActionName, idempotencyKey: string, organizationId?: string): Promise<ActionOutcome | null>;
}

export type ConnectorRegistry = Record<string, Connector>;

export function resolveConnector(registry: ConnectorRegistry, connectorId: string): Connector | undefined {
  return registry[connectorId];
}

export type ActionOutcome =
  | { status: "succeeded"; connectorReference: string; detail?: string }
  | { status: "failed"; reason: string }
  | { status: "unknown"; reason: string };
