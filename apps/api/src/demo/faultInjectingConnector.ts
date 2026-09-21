import type { Connector, RefundOutcome } from "@trustrail/gateway-core";

/**
 * Demo-only wrapper that makes the "merchant succeeds but connection times
 * out" scenario (docs/PRODUCT_SPEC.md section 14) deterministic and
 * repeatable: the FIRST createRefund() call for a given connector
 * idempotency key (the TrustRail action ID) reports `unknown` without
 * ever calling the real connector; every subsequent call (a worker retry,
 * or a resubmission) goes through to the real merchant sandbox normally.
 * This exercises the real dispatch/reconciliation code path
 * (@trustrail/gateway-core's dispatch.ts/poller.ts) against a genuinely
 * ambiguous first outcome -- only the connector's response is faked, never
 * the gateway's handling of it.
 *
 * Gated by APP_MODE=local/demo the same as every other demo-only surface
 * (spec: "Production mode must reject demo reset and fault-injection
 * endpoints") -- this wrapper is only ever constructed when
 * config.allowDemoEndpoints is true; see src/index.ts.
 */
export function createFaultInjectingConnector(real: Connector): Connector {
  const alreadyTimedOut = new Set<string>();

  return {
    connectorId: real.connectorId,
    lookupOrder: real.lookupOrder.bind(real),
    lookupRefundByIdempotencyKey: real.lookupRefundByIdempotencyKey.bind(real),
    async createRefund(input): Promise<RefundOutcome> {
      if (!alreadyTimedOut.has(input.idempotencyKey)) {
        alreadyTimedOut.add(input.idempotencyKey);
        return { status: "unknown", reason: "simulated connector timeout (demo fault injection)" };
      }
      return real.createRefund(input);
    },
  };
}
