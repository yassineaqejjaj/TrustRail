import type { Currency } from "@trustrail/contracts";
import type { Connector, ActionOutcome } from "@trustrail/gateway-core";
import type { SubscriptionAccountFacts } from "@trustrail/policy-engine";

export interface SaasSandboxConnectorOptions {
  baseUrl: string;
  gatewaySecret: string;
  timeoutMs?: number;
}

/**
 * HTTP client for the SaaS sandbox's internal API (apps/saas-sandbox) --
 * the second use case (grant account credit, change plan, activate a
 * feature, invite a user), dispatched separately from
 * `merchantSandboxConnector.ts`'s refund.create. Same shape, same
 * gateway-shared-secret auth, same "a timeout is `unknown`, never
 * `failed`" rule -- see that file's header comment for why.
 */
export function createSaasSandboxConnector(opts: SaasSandboxConnectorOptions): Connector {
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
    connectorId: "saas_sandbox",

    async lookupResource({ organizationId, resourceId }): Promise<SubscriptionAccountFacts | { found: false }> {
      const result = await request(`/internal/accounts/${encodeURIComponent(resourceId)}?organization_id=${encodeURIComponent(organizationId)}`, { method: "GET" });
      if (!result.ok) {
        return { found: false };
      }
      return {
        kind: "subscription_account",
        found: true,
        suspended: result.body.suspended,
        currentPlanId: result.body.plan_id,
        activeFeatureKeys: result.body.feature_keys,
        userCount: result.body.user_count,
        adminUserCount: result.body.admin_user_count,
        currency: result.body.currency as Currency,
      };
    },

    async executeAction({ organizationId, resourceId, action, arguments: args, idempotencyKey }): Promise<ActionOutcome> {
      const result = await request("/internal/actions", {
        method: "POST",
        body: JSON.stringify({
          organization_id: organizationId,
          account_id: resourceId,
          action,
          arguments: args,
          idempotency_key: idempotencyKey,
        }),
      });
      if ("timedOut" in result) {
        return { status: "unknown", reason: "connector request timed out" };
      }
      if (!result.ok) {
        if (result.status === 409) {
          return { status: "failed", reason: "account is suspended" };
        }
        if (result.status === 422) {
          return { status: "failed", reason: result.body?.message ?? "invalid plan" };
        }
        return { status: "failed", reason: `connector returned ${result.status}` };
      }
      return { status: "succeeded", connectorReference: result.body.reference_id, detail: result.body.detail };
    },

    async lookupActionByIdempotencyKey(_action, idempotencyKey: string, organizationId?: string): Promise<ActionOutcome | null> {
      const result = await request(`/internal/actions/by-key/${encodeURIComponent(idempotencyKey)}?organization_id=${encodeURIComponent(organizationId ?? "")}`, { method: "GET" });
      if ("timedOut" in result) {
        return { status: "unknown", reason: "connector request timed out" };
      }
      if (!result.ok) return null;
      return { status: "succeeded", connectorReference: result.body.reference_id, detail: result.body.detail };
    },
  };
}
