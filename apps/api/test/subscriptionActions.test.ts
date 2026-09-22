import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestHarness, type TestHarness } from "./harness.js";
import {
  DEFAULT_GRANT_CREDIT_POLICY_BUNDLE,
  DEFAULT_CHANGE_PLAN_POLICY_BUNDLE,
  DEFAULT_ACTIVATE_FEATURE_POLICY_BUNDLE,
  DEFAULT_INVITE_USER_POLICY_BUNDLE,
} from "@trustrail/contracts";

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
  await h.seedSaasAccounts(organizationId);
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

async function createGrant(cookie: string, organizationId: string, principalId: string, agentId: string, action: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/grants",
    headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId },
    payload: {
      environment: "sandbox",
      principal_id: principalId,
      subject_agent_id: agentId,
      parent_grant_id: null,
      allowed_actions: [action],
      allowed_resource_ids: [],
      unrestricted_resources: true,
      allowed_connector_ids: ["saas_sandbox"],
      currency: "EUR",
      max_amount_minor: 50_000,
      root_budget_limit_minor: 100_000,
      child_budget_limit_minor: null,
      valid_from: null,
      expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      delegation_allowed: false,
      max_remaining_depth: 0,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().grant_id as string;
}

async function publishPolicy(cookie: string, organizationId: string, bundle: unknown) {
  const draft = await h.app.inject({
    method: "POST",
    url: "/v1/policies",
    headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId },
    payload: { environment: "sandbox", bundle },
  });
  expect(draft.statusCode).toBe(201);
  const publish = await h.app.inject({
    method: "POST",
    url: `/v1/policies/${draft.json().policy_bundle_id}/publish`,
    headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId },
    payload: { version_id: draft.json().version_id, expected_revision: 0 },
  });
  expect(publish.statusCode).toBe(200);
}

describe("subscription actions: the second use case, end to end", () => {
  let cookie: string;
  let organizationId: string;
  let userId: string;
  let agentId: string;
  let agentSecret: string;

  beforeAll(async () => {
    ({ cookie, organizationId, userId } = await registerAndCreateOrg("saas-owner@example.com", "SaaS Demo Co"));
    agentId = await createAgent(cookie, organizationId, "IT Onboarding Agent");
    agentSecret = await createCredential(cookie, organizationId, agentId);
    await publishPolicy(cookie, organizationId, DEFAULT_GRANT_CREDIT_POLICY_BUNDLE);
    await publishPolicy(cookie, organizationId, DEFAULT_CHANGE_PLAN_POLICY_BUNDLE);
    await publishPolicy(cookie, organizationId, DEFAULT_ACTIVATE_FEATURE_POLICY_BUNDLE);
    await publishPolicy(cookie, organizationId, DEFAULT_INVITE_USER_POLICY_BUNDLE);
  }, 30_000);

  it("grant_credit: EUR 100 is within the automatic limit and actually lands in the sandbox", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.grant_credit");
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-credit-001" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.grant_credit", resource_id: "account_demo_lea", arguments: { amount_minor: 10_000, currency: "EUR", reason: "Onboarding credit" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("ALLOW");
    expect(res.json().execution_state).toBe("succeeded");
    expect(res.json().connector_reference).toBeTruthy();
  });

  it("grant_credit: EUR 200 exceeds the automatic limit, requires approval, then succeeds once approved", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.grant_credit");
    const submit = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-credit-002" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.grant_credit", resource_id: "account_demo_lea", arguments: { amount_minor: 20_000, currency: "EUR", reason: "Large exception" } },
    });
    expect(submit.statusCode).toBe(202);
    expect(submit.json().decision).toBe("REQUIRE_APPROVAL");

    const reviewerReg = await h.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "saas-reviewer@example.com", password: "another strong password 123" } });
    const reviewerCookie = extractCookie(reviewerReg);
    await h.app.inject({ method: "POST", url: "/v1/memberships", headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId }, payload: { email: "saas-reviewer@example.com", role: "approver" } });
    const approve = await h.app.inject({
      method: "POST",
      url: `/v1/approvals/${submit.json().approval.approval_id}/approve`,
      headers: { "x-trustrail-csrf": "1", cookie: reviewerCookie, "x-organization-id": organizationId },
      payload: { reason: "confirmed with finance" },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().execution_state).toBe("succeeded");
  });

  it("change_plan: an eligible upgrade auto-allows", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.change_plan");
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-plan-001" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.change_plan", resource_id: "account_demo_lea", arguments: { target_plan: "scale", reason: "Growing team" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().execution_state).toBe("succeeded");
  });

  it("change_plan: a plan outside the eligible list is denied outright, never reaching the sandbox", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.change_plan");
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-plan-002" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.change_plan", resource_id: "account_demo_lea", arguments: { target_plan: "enterprise", reason: "Just curious" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("DENY");
    expect(res.json().reason_codes).toContain("PLAN_NOT_ELIGIBLE");
    expect(res.json().connector_reference).toBeNull();
  });

  it("activate_feature: an allowed feature auto-allows", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.activate_feature");
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-feature-001" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.activate_feature", resource_id: "account_demo_lea", arguments: { feature_key: "sso", reason: "Security requirement" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().execution_state).toBe("succeeded");
  });

  it("activate_feature: a disallowed feature is denied, never held for approval", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.activate_feature");
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-feature-002" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.activate_feature", resource_id: "account_demo_lea", arguments: { feature_key: "white_label", reason: "Nice to have" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("DENY");
    expect(res.json().reason_codes).toContain("FEATURE_NOT_ALLOWED");
  });

  // Recreates the product brief's own onboarding example almost exactly:
  // "cree ses acces... sans droits administrateur... Demande une
  // validation pour toute exception."
  describe("invite_user: Lea's onboarding example", () => {
    it("an allowed role (member) auto-allows", async () => {
      const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.invite_user");
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/actions",
        headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-invite-001" },
        payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.invite_user", resource_id: "account_demo_lea", arguments: { email: "lea@example.com", role: "member", reason: "New hire onboarding" } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().execution_state).toBe("succeeded");
    });

    it("the admin role is a hard block -- 'no admin rights' has no exception path", async () => {
      const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.invite_user");
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/actions",
        headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-invite-002" },
        payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.invite_user", resource_id: "account_demo_lea", arguments: { email: "lea@example.com", role: "admin", reason: "She asked nicely" } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe("DENY");
      expect(res.json().reason_codes).toContain("ROLE_NOT_ALLOWED");
      expect(res.json().connector_reference).toBeNull();
    });

    it("a role outside the normal set is the 'exception' that requires validation, and succeeds once approved", async () => {
      const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.invite_user");
      const submit = await h.app.inject({
        method: "POST",
        url: "/v1/actions",
        headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-invite-003" },
        payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.invite_user", resource_id: "account_demo_lea", arguments: { email: "contractor@example.com", role: "contractor", reason: "Temporary access" } },
      });
      expect(submit.statusCode).toBe(202);
      expect(submit.json().decision).toBe("REQUIRE_APPROVAL");

      const reviewerReg = await h.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "saas-reviewer-2@example.com", password: "another strong password 123" } });
      const reviewerCookie = extractCookie(reviewerReg);
      await h.app.inject({ method: "POST", url: "/v1/memberships", headers: { cookie, "x-trustrail-csrf": "1", "x-organization-id": organizationId }, payload: { email: "saas-reviewer-2@example.com", role: "approver" } });
      const approve = await h.app.inject({
        method: "POST",
        url: `/v1/approvals/${submit.json().approval.approval_id}/approve`,
        headers: { "x-trustrail-csrf": "1", cookie: reviewerCookie, "x-organization-id": organizationId },
        payload: { reason: "confirmed the contractor's scope" },
      });
      expect(approve.statusCode).toBe(200);
      expect(approve.json().execution_state).toBe("succeeded");
    });
  });

  it("a suspended account is denied for every subscription action, before any policy-specific check", async () => {
    const grantId = await createGrant(cookie, organizationId, userId, agentId, "subscription.activate_feature");
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${agentSecret}`, "idempotency-key": "saas-suspended-001" },
      payload: { grant_id: grantId, connector_id: "saas_sandbox", action: "subscription.activate_feature", resource_id: "account_demo_suspended", arguments: { feature_key: "sso", reason: "Try anyway" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("DENY");
    expect(res.json().reason_codes).toContain("STATE_UNAVAILABLE");
  });
});
