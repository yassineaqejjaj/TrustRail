import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestHarness, type TestHarness } from "./harness.js";

let h: TestHarness;

beforeAll(async () => {
  h = await setupTestHarness();
}, 60_000);

afterAll(async () => {
  await h.teardown();
});

function extractCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((c) => c.name === "trustrail_session");
  if (!c) throw new Error("no session cookie set");
  return `trustrail_session=${c.value}`;
}

async function registerAndCreateOrg(email: string, orgName: string) {
  const reg = await h.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, password: "correct horse battery staple" } });
  expect(reg.statusCode).toBe(201);
  const cookie = extractCookie(reg);
  const orgRes = await h.app.inject({ method: "POST", url: "/v1/organizations", headers: { cookie, "x-trustrail-csrf": "1" }, payload: { name: orgName } });
  expect(orgRes.statusCode).toBe(201);
  const organizationId = orgRes.json().organization_id as string;
  await h.seedMerchantOrders(organizationId);
  return { cookie, organizationId, userId: reg.json().user_id as string };
}

async function createAgent(cookie: string, organizationId: string, name: string) {
  const res = await h.app.inject({ method: "POST", url: "/v1/agents", headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId }, payload: { name, description: "", environment: "sandbox" } });
  expect(res.statusCode).toBe(201);
  return res.json().agent_id as string;
}

async function createCredential(cookie: string, organizationId: string, agentId: string) {
  const res = await h.app.inject({ method: "POST", url: `/v1/agents/${agentId}/credentials`, headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId } });
  expect(res.statusCode).toBe(201);
  return res.json().secret as string;
}

async function createRootGrant(cookie: string, organizationId: string, principalId: string, agentId: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/grants",
    headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId },
    payload: {
      environment: "sandbox",
      principal_id: principalId,
      subject_agent_id: agentId,
      parent_grant_id: null,
      allowed_actions: ["refund.create"],
      allowed_resource_ids: [],
      unrestricted_resources: true,
      allowed_connector_ids: ["merchant_sandbox"],
      currency: "EUR",
      max_amount_minor: 50_000,
      root_budget_limit_minor: 100_000,
      child_budget_limit_minor: null,
      valid_from: null,
      expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      delegation_allowed: true,
      max_remaining_depth: 3,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().grant_id as string;
}

describe("anomaly detection: a burst of requests from one agent", () => {
  let cookie: string;
  let organizationId: string;
  let userId: string;
  let burstyAgentId: string;
  let burstyAgentSecret: string;
  let quietAgentId: string;
  let quietAgentSecret: string;
  let grantId: string;
  let quietGrantId: string;

  beforeAll(async () => {
    ({ cookie, organizationId, userId } = await registerAndCreateOrg("anomaly-owner@example.com", "Anomaly Co"));
    burstyAgentId = await createAgent(cookie, organizationId, "Bursty Agent");
    burstyAgentSecret = await createCredential(cookie, organizationId, burstyAgentId);
    grantId = await createRootGrant(cookie, organizationId, userId, burstyAgentId);

    quietAgentId = await createAgent(cookie, organizationId, "Quiet Agent");
    quietAgentSecret = await createCredential(cookie, organizationId, quietAgentId);
    quietGrantId = await createRootGrant(cookie, organizationId, userId, quietAgentId);

    // Six quick EUR 20.00 refunds across six different seeded orders --
    // all well under the automatic limit, so every one succeeds normally.
    // The point isn't that anything gets denied; it's that the volume
    // itself is what should surface as an anomaly.
    const orderIds = ["order_demo_101", "order_demo_102", "order_demo_106", "order_demo_107", "order_demo_108", "order_demo_109"];
    for (const [i, orderId] of orderIds.entries()) {
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/actions",
        headers: { authorization: `Bearer ${burstyAgentSecret}`, "idempotency-key": `anomaly-burst-${i}` },
        payload: { grant_id: grantId, connector_id: "merchant_sandbox", action: "refund.create", resource_id: orderId, arguments: { amount_minor: 2_000, currency: "EUR", reason: "Return" } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().execution_state).toBe("succeeded");
    }

    // The quiet agent submits exactly one request in the same window.
    const quiet = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${quietAgentSecret}`, "idempotency-key": "anomaly-quiet-0" },
      payload: { grant_id: quietGrantId, connector_id: "merchant_sandbox", action: "refund.create", resource_id: "order_demo_110", arguments: { amount_minor: 2_000, currency: "EUR", reason: "Return" } },
    });
    expect(quiet.statusCode).toBe(200);
  }, 30_000);

  it("flags the bursty agent but not the quiet one, using a threshold below the burst size", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/security/anomalies?window_seconds=60&threshold=5",
      headers: { cookie, "x-organization-id": organizationId },
    });
    expect(res.statusCode).toBe(200);
    const anomalies = res.json().anomalies as Array<{ agent_id: string; request_count: number }>;
    expect(anomalies.find((a) => a.agent_id === burstyAgentId)?.request_count).toBe(6);
    expect(anomalies.find((a) => a.agent_id === quietAgentId)).toBeUndefined();
  });

  it("does not flag anyone once the threshold is above the burst size", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/security/anomalies?window_seconds=60&threshold=50",
      headers: { cookie, "x-organization-id": organizationId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().anomalies).toEqual([]);
  });

  it("refuses a non-admin role", async () => {
    const approverReg = await h.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "anomaly-approver@example.com", password: "another strong password 123" } });
    const approverCookie = extractCookie(approverReg);
    const addMember = await h.app.inject({ method: "POST", url: "/v1/memberships", headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId }, payload: { email: "anomaly-approver@example.com", role: "approver" } });
    expect(addMember.statusCode).toBe(201);

    const res = await h.app.inject({ method: "GET", url: "/v1/security/anomalies", headers: { cookie: approverCookie, "x-organization-id": organizationId } });
    expect(res.statusCode).toBe(403);
  });
});
