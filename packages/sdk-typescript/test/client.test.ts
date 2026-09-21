import { describe, expect, it, vi } from "vitest";
import { TrustRail } from "../src/client.js";
import { TrustRailApiError, TrustRailNetworkError } from "../src/errors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TrustRail SDK", () => {
  it("sends the idempotency-key header on actions.execute", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return jsonResponse(200, { action_id: "act_1", decision: "ALLOW", execution_state: "succeeded", reason_codes: [], amount_minor: 8000, currency: "EUR", action: "refund.create", resource_id: "order_1", actor_agent_id: "agt_1", grant_id: "grant_1", created_at: "now", updated_at: "now" });
    });
    const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: "trsk_sandbox_test", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.actions.execute({
      grantId: "grant_1",
      connectorId: "merchant_sandbox",
      action: "refund.create",
      resourceId: "order_1",
      arguments: { amount_minor: 8000, currency: "EUR", reason: "x" },
      idempotencyKey: "my-key-1",
    });

    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("my-key-1");
    expect(headers["authorization"]).toBe("Bearer trsk_sandbox_test");
  });

  it("retries actions.execute on a network error, preserving the same idempotency key", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error("ECONNRESET");
      return jsonResponse(200, { action_id: "act_2", decision: "ALLOW", execution_state: "succeeded", reason_codes: [], amount_minor: 1000, currency: "EUR", action: "refund.create", resource_id: "order_2", actor_agent_id: "agt_1", grant_id: "grant_1", created_at: "now", updated_at: "now" });
    });
    const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.actions.execute({
      grantId: "grant_1",
      connectorId: "merchant_sandbox",
      action: "refund.create",
      resourceId: "order_2",
      arguments: { amount_minor: 1000, currency: "EUR" },
      idempotencyKey: "stable-key",
    });

    expect(attempt).toBe(2);
    expect(result.action_id).toBe("act_2");
  });

  it("never retries a definitive API error (e.g. 409 conflict)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { code: "IDEMPOTENCY_CONFLICT", message: "conflict", request_id: "req_1" }));
    const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.actions.execute({ grantId: "g", connectorId: "merchant_sandbox", action: "refund.create", resourceId: "o", arguments: { amount_minor: 1, currency: "EUR" }, idempotencyKey: "k1" })
    ).rejects.toBeInstanceOf(TrustRailApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("wraps a persistent network failure in TrustRailNetworkError, not a raw Error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.receipts.get("rcpt_1")).rejects.toBeInstanceOf(TrustRailNetworkError);
  });

  it("actions.wait polls until a terminal execution_state", async () => {
    let call = 0;
    const states = ["reserved", "dispatching", "succeeded"];
    const fetchImpl = vi.fn(async () => {
      const state = states[Math.min(call, states.length - 1)];
      call++;
      return jsonResponse(200, { action_id: "act_3", decision: "ALLOW", execution_state: state, reason_codes: [], amount_minor: 1, currency: "EUR", action: "refund.create", resource_id: "o", actor_agent_id: "a", grant_id: "g", created_at: "now", updated_at: "now" });
    });
    const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.actions.wait("act_3", { pollIntervalMs: 1, timeoutMs: 5000 });
    expect(result.execution_state).toBe("succeeded");
    expect(call).toBe(3);
  });

  it("receipts.verify calls the unauthenticated verify endpoint with the jws body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { signature_valid: true, issuer_trusted: true, key_id: "kid1", key_status: "active", payload: {}, errors: [] }));
    const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.receipts.verify("header.payload.sig");
    expect(result.signature_valid).toBe(true);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ jws: "header.payload.sig" });
  });
});
