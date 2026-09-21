import { readFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { STATE_PATH, type E2eState } from "./global-setup.js";
import * as merchantSchema from "../../apps/merchant-sandbox/src/db/schema.js";
import { seedMerchantSandbox } from "../../apps/merchant-sandbox/src/seed.js";

export function loadState(): E2eState {
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

export interface SeededOrg {
  organizationId: string;
  ownerEmail: string;
  ownerCookie: string;
  agentId: string;
  agentSecret: string;
  grantId: string;
  userId: string;
}

/** Sets up an organization, agent, credential, root grant, and merchant orders entirely over the real HTTP API (no UI). */
export async function seedOrgWithGrant(state: E2eState, emailPrefix: string): Promise<SeededOrg> {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const register = await fetch(`${state.apiBaseUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple" }),
  });
  const cookie = register.headers.get("set-cookie")!.split(";")[0]!;
  const { user_id: userId } = await register.json();

  const orgRes = await fetch(`${state.apiBaseUrl}/v1/organizations`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: `${emailPrefix} Org` }),
  });
  const { organization_id: organizationId } = await orgRes.json();

  const pool = new pg.Pool({ connectionString: state.merchantMigratorUrl });
  const merchantDb = drizzle(pool, { schema: merchantSchema });
  await seedMerchantSandbox(merchantDb, organizationId);
  await pool.end();

  const agentRes = await fetch(`${state.apiBaseUrl}/v1/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-organization-id": organizationId },
    body: JSON.stringify({ name: "E2E Agent", description: "", environment: "sandbox" }),
  });
  const { agent_id: agentId } = await agentRes.json();

  const credRes = await fetch(`${state.apiBaseUrl}/v1/agents/${agentId}/credentials`, {
    method: "POST",
    headers: { cookie, "x-organization-id": organizationId },
  });
  const { secret: agentSecret } = await credRes.json();

  const grantRes = await fetch(`${state.apiBaseUrl}/v1/grants`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-organization-id": organizationId },
    body: JSON.stringify({
      environment: "sandbox",
      principal_id: userId,
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
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      delegation_allowed: false,
      max_remaining_depth: 0,
    }),
  });
  const { grant_id: grantId } = await grantRes.json();

  return { organizationId, ownerEmail: email, ownerCookie: cookie, agentId, agentSecret, grantId, userId };
}

/** Registers a second user and adds them as Approver to an existing org (for the independent-reviewer flow). */
export async function addApprover(state: E2eState, org: SeededOrg, emailPrefix: string): Promise<{ email: string; password: string }> {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const password = "another strong password 123";
  await fetch(`${state.apiBaseUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await fetch(`${state.apiBaseUrl}/v1/memberships`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: org.ownerCookie, "x-organization-id": org.organizationId },
    body: JSON.stringify({ email, role: "approver" }),
  });
  return { email, password };
}

export async function submitAction(state: E2eState, org: SeededOrg, resourceId: string, amountMinor: number, idempotencyKey: string) {
  const res = await fetch(`${state.apiBaseUrl}/v1/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${org.agentSecret}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ grant_id: org.grantId, connector_id: "merchant_sandbox", action: "refund.create", resource_id: resourceId, arguments: { amount_minor: amountMinor, currency: "EUR", reason: "e2e" } }),
  });
  return res.json();
}
