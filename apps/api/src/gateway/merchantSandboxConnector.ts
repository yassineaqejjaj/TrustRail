import { MISMATCHED_OWNER_CUSTOMER_REF, type Currency } from "@trustrail/contracts";
import type { Connector, RefundOutcome } from "@trustrail/gateway-core";

export interface MerchantSandboxConnectorOptions {
  baseUrl: string;
  gatewaySecret: string;
  timeoutMs?: number;
}

/**
 * HTTP client for the merchant sandbox's internal API. This is the ONLY
 * place the gateway-shared secret is used to reach a downstream system --
 * agents and browsers never see it (docs/PRODUCT_SPEC.md section 3).
 *
 * A request timeout is reported as `{status: "unknown"}` rather than
 * `"failed"`, matching the "merchant succeeds but connection times out"
 * demo scenario: the caller cannot tell whether the write landed, so the
 * gateway must keep the budget reservation until reconciliation resolves it
 * (the worker retries automatically with backoff via
 * @trustrail/gateway-core's dispatchAction; if it gives up, a human
 * resolves it via src/gateway/reconciliation.ts).
 *
 * NOTE on order ownership: this synthetic sandbox does not model a real
 * mapping between TrustRail principals and the merchant's own customer
 * records, so `ownedByPrincipal` cannot be resolved from actual identity
 * matching. It reports `true` for every order except the one deliberate
 * fixture carrying `MISMATCHED_OWNER_CUSTOMER_REF` -- enough for
 * `require_order_ownership` to be a real, demonstrable gate (see
 * order_demo_not_owned in packages/contracts/src/demoFixtures.ts) rather
 * than a permanently-true stub, without claiming a real ownership
 * resolution this sandbox has no data to support. A real connector
 * integration would resolve this from the merchant's own customer/account
 * records. Documented in docs/BUILD_STATUS.md.
 */
export function createMerchantSandboxConnector(opts: MerchantSandboxConnectorOptions): Connector {
  const timeoutMs = opts.timeoutMs ?? 5000;

  async function request(path: string, init: RequestInit): Promise<{ ok: true; body: any } | { ok: false; status: number; body: any } | { ok: false; timedOut: true }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${opts.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-gateway-secret": opts.gatewaySecret, ...(init.headers ?? {}) },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, body };
      return { ok: true, body };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { ok: false, timedOut: true };
      }
      return { ok: false, timedOut: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    connectorId: "merchant_sandbox",

    async lookupOrder({ organizationId, resourceId }) {
      const result = await request(`/internal/orders/${encodeURIComponent(resourceId)}?organization_id=${encodeURIComponent(organizationId)}`, { method: "GET" });
      if (!result.ok) {
        return { found: false, ownedByPrincipal: false, ageDays: 0, disputed: false, remainingAmountMinor: 0, currency: "EUR" };
      }
      return {
        found: true,
        ownedByPrincipal: result.body.customer_ref !== MISMATCHED_OWNER_CUSTOMER_REF,
        ageDays: result.body.age_days,
        disputed: result.body.disputed,
        remainingAmountMinor: result.body.amount_minor,
        currency: result.body.currency as Currency,
      };
    },

    async createRefund({ organizationId, resourceId, amountMinor, currency, idempotencyKey }): Promise<RefundOutcome> {
      const result = await request("/internal/refunds", {
        method: "POST",
        body: JSON.stringify({
          organization_id: organizationId,
          order_id: resourceId,
          amount_minor: amountMinor,
          currency,
          idempotency_key: idempotencyKey,
        }),
      });
      if ("timedOut" in result) {
        return { status: "unknown", reason: "connector request timed out" };
      }
      if (!result.ok) {
        if (result.status === 409) {
          return { status: "failed", reason: "insufficient remaining balance" };
        }
        return { status: "failed", reason: `connector returned ${result.status}` };
      }
      return { status: "succeeded", connectorReference: result.body.refund_id, destination: result.body.destination };
    },

    async lookupRefundByIdempotencyKey(idempotencyKey: string): Promise<RefundOutcome | null> {
      const result = await request(`/internal/refunds/by-key/${encodeURIComponent(idempotencyKey)}`, { method: "GET" });
      if ("timedOut" in result) {
        return { status: "unknown", reason: "connector request timed out" };
      }
      if (!result.ok) return null;
      return { status: "succeeded", connectorReference: result.body.refund_id, destination: result.body.destination };
    },
  };
}
