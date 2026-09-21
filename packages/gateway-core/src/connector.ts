import type { Currency } from "@trustrail/contracts";
import type { OrderFacts } from "@trustrail/policy-engine";

/**
 * The connector interface is implemented once for the merchant sandbox in
 * this file's companion, `merchantSandboxConnector.ts`. Per
 * docs/PRODUCT_SPEC.md section 12, connectors are configured by trusted
 * operators against an allowlist -- there is no user-suppliable URL or
 * generic HTTP-forwarding capability anywhere in this codebase, which is
 * what keeps the gateway from being an SSRF endpoint.
 */
export interface Connector {
  readonly connectorId: string;
  lookupOrder(input: { organizationId: string; resourceId: string }): Promise<OrderFacts>;
  createRefund(input: {
    organizationId: string;
    resourceId: string;
    amountMinor: number;
    currency: Currency;
    idempotencyKey: string;
  }): Promise<RefundOutcome>;
  lookupRefundByIdempotencyKey(idempotencyKey: string): Promise<RefundOutcome | null>;
}

export type RefundOutcome =
  | { status: "succeeded"; connectorReference: string; destination: string }
  | { status: "failed"; reason: string }
  | { status: "unknown"; reason: string };
