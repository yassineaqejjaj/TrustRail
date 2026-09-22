import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestHarness, type TestHarness } from "./harness.js";
import { buildApp } from "../src/server.js";
import { createMerchantSandboxConnector } from "../src/gateway/merchantSandboxConnector.js";
import { dispatchAction, MAX_AUTO_RETRY_ATTEMPTS, type Connector } from "@trustrail/gateway-core";
import type { FastifyInstance } from "fastify";

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

describe("reconciliation: actions permanently stuck in `unknown`", () => {
  let cookie: string;
  let organizationId: string;
  let userId: string;
  let agentId: string;
  let agentSecret: string;
  let grantId: string;
  let flakyApp: FastifyInstance;
  let actionId: string;

  beforeAll(async () => {
    ({ cookie, organizationId, userId } = await registerAndCreateOrg("reconcile-owner@example.com", "Reconcile Co"));
    agentId = await createAgent(cookie, organizationId, "Refund Agent");
    agentSecret = await createCredential(cookie, organizationId, agentId);
    grantId = await createRootGrant(cookie, organizationId, userId, agentId);

    // A connector whose resource lookups are real (so policy evaluation sees
    // a genuine, ownable order) but whose executeAction call always times
    // out -- simulating a merchant integration that never recovers, unlike
    // createFaultInjectingConnector's "succeeds on the second try".
    const realConnector = createMerchantSandboxConnector({ baseUrl: h.merchantBaseUrl, gatewaySecret: h.gatewaySecret, timeoutMs: 2000 });
    const alwaysUnknownConnector: Connector = {
      connectorId: realConnector.connectorId,
      lookupResource: realConnector.lookupResource.bind(realConnector),
      lookupActionByIdempotencyKey: realConnector.lookupActionByIdempotencyKey.bind(realConnector),
      async executeAction() {
        return { status: "unknown", reason: "test: simulated permanent connector outage" };
      },
    };
    const connectors = { ...h.connectors, merchant_sandbox: alwaysUnknownConnector };
    const gatewayDeps = { connectors, signingKey: h.signingKey, issuer: h.config.RECEIPT_ISSUER };
    flakyApp = buildApp({ db: h.db, config: h.config, connectors, gatewayDeps });
    await flakyApp.ready();

    const submit = await flakyApp.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "reconcile-test-001" },
      payload: { grant_id: grantId, connector_id: "merchant_sandbox", action: "refund.create", resource_id: "order_demo_101", arguments: { amount_minor: 5_000, currency: "EUR", reason: "Return" } },
    });
    expect(submit.statusCode).toBe(202);
    expect(submit.json().decision).toBe("ALLOW");
    expect(submit.json().execution_state).toBe("unknown");
    actionId = submit.json().action_id;

    // Drive the remaining retries directly (the worker would normally do
    // this on its poll interval) until the auto-retry cap is hit and the
    // job is handed to a human.
    for (let attempt = 1; attempt < MAX_AUTO_RETRY_ATTEMPTS; attempt++) {
      const state = await dispatchAction(h.db, gatewayDeps, organizationId, actionId);
      expect(state).toBe("unknown");
    }
  }, 30_000);

  afterAll(async () => {
    await flakyApp.close();
  });

  it("lists the stuck action in the reconciliation report, flagged for manual review", async () => {
    const res = await h.app.inject({ method: "GET", url: "/v1/reconciliation", headers: { cookie, "x-organization-id": organizationId } });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { action_id: string }) => i.action_id === actionId);
    expect(item).toBeTruthy();
    expect(item.needs_manual_review).toBe(true);
    expect(item.job_status).toBe("stuck");
    expect(item.attempt_count).toBe(MAX_AUTO_RETRY_ATTEMPTS);
  });

  it("refuses a viewer role, requires at least approver", async () => {
    const viewerReg = await h.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "viewer@example.com", password: "another strong password 123" } });
    const viewerCookie = extractCookie(viewerReg);
    const addMember = await h.app.inject({ method: "POST", url: "/v1/memberships", headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId }, payload: { email: "viewer@example.com", role: "viewer" } });
    expect(addMember.statusCode).toBe(201);

    const res = await h.app.inject({ method: "GET", url: "/v1/reconciliation", headers: { cookie: viewerCookie, "x-organization-id": organizationId } });
    expect(res.statusCode).toBe(403);
  });

  it("lets a human manually resolve it as succeeded, committing the budget and issuing a receipt", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/reconciliation/${actionId}/resolve`,
      headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId },
      payload: { outcome: "succeeded", note: "Confirmed directly with the merchant: refund landed.", connector_reference: "manual-check-001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().execution_state).toBe("succeeded");

    const detail = await h.app.inject({ method: "GET", url: `/v1/actions/${actionId}`, headers: { cookie, "x-organization-id": organizationId } });
    expect(detail.json().execution_state).toBe("succeeded");
    expect(detail.json().connector_reference).toBe("manual-check-001");
    const executionReceipts = detail.json().receipts.filter((r: { receipt_type: string }) => r.receipt_type === "execution");
    expect(executionReceipts.length).toBeGreaterThanOrEqual(1);

    // No longer listed as needing reconciliation.
    const list = await h.app.inject({ method: "GET", url: "/v1/reconciliation", headers: { cookie, "x-organization-id": organizationId } });
    expect(list.json().items.find((i: { action_id: string }) => i.action_id === actionId)).toBeUndefined();
  });

  it("refuses to resolve an action that isn't in `unknown` state anymore", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/reconciliation/${actionId}/resolve`,
      headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId },
      payload: { outcome: "failed", note: "retry" },
    });
    expect(res.statusCode).toBe(409);
  });
});
