import { readFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { STATE_PATH, type E2eState } from "./global-setup.js";
import * as merchantSchema from "../../apps/merchant-sandbox/src/db/schema.js";
import { seedMerchantSandbox } from "../../apps/merchant-sandbox/src/seed.js";
import * as apiSchema from "@trustrail/db";
import { seedNorthstarCommerce, DEMO_PASSWORD, type SeedResult } from "../../apps/api/src/demo/seedNorthstar.js";
import { DEMO_USERS } from "@trustrail/contracts";

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

export interface BareOrg {
  organizationId: string;
  ownerEmail: string;
  userId: string;
}

/**
 * Registers a user and creates an organization for them over the real API,
 * without also seeding an agent/credential/grant/merchant orders (unlike
 * seedOrgWithGrant) -- for specs that need the onboarding checklist's
 * early, not-yet-completed steps (e.g. "Register an agent" still showing
 * as the next action).
 */
export async function registerOrgOwner(state: E2eState, emailPrefix: string): Promise<BareOrg> {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const register = await fetch(`${state.apiBaseUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple" }),
  });
  const { user_id: userId } = await register.json();
  const cookie = register.headers.get("set-cookie")!.split(";")[0]!;

  const orgRes = await fetch(`${state.apiBaseUrl}/v1/organizations`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie },
    body: JSON.stringify({ name: `${emailPrefix} Org` }),
  });
  const { organization_id: organizationId } = await orgRes.json();

  return { organizationId, ownerEmail: email, userId };
}

/** Sets up an organization, agent, credential, root grant, and merchant orders entirely over the real HTTP API (no UI). */
export async function seedOrgWithGrant(
  state: E2eState,
  emailPrefix: string,
  opts: { delegationAllowed?: boolean; maxRemainingDepth?: number } = {}
): Promise<SeededOrg> {
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
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie  },
    body: JSON.stringify({ name: `${emailPrefix} Org` }),
  });
  const { organization_id: organizationId } = await orgRes.json();

  const pool = new pg.Pool({ connectionString: state.merchantMigratorUrl });
  const merchantDb = drizzle(pool, { schema: merchantSchema });
  await seedMerchantSandbox(merchantDb, organizationId);
  await pool.end();

  const agentRes = await fetch(`${state.apiBaseUrl}/v1/agents`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie, "x-organization-id": organizationId  },
    body: JSON.stringify({ name: "E2E Agent", description: "", environment: "sandbox" }),
  });
  const { agent_id: agentId } = await agentRes.json();

  const credRes = await fetch(`${state.apiBaseUrl}/v1/agents/${agentId}/credentials`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", cookie, "x-organization-id": organizationId  },
  });
  const { secret: agentSecret } = await credRes.json();

  const grantRes = await fetch(`${state.apiBaseUrl}/v1/grants`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie, "x-organization-id": organizationId  },
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
      delegation_allowed: opts.delegationAllowed ?? false,
      max_remaining_depth: opts.maxRemainingDepth ?? 0,
    }),
  });
  const { grant_id: grantId } = await grantRes.json();

  return { organizationId, ownerEmail: email, ownerCookie: cookie, agentId, agentSecret, grantId, userId };
}

/** Registers a second agent in an existing org (for delegation tests that need a distinct child-grant subject). */
export async function createAgent(state: E2eState, org: SeededOrg, name: string): Promise<{ agentId: string }> {
  const agentRes = await fetch(`${state.apiBaseUrl}/v1/agents`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie: org.ownerCookie, "x-organization-id": org.organizationId },
    body: JSON.stringify({ name, description: "", environment: "sandbox" }),
  });
  const { agent_id: agentId } = await agentRes.json();
  return { agentId };
}

/**
 * Issues a child grant delegated from `org`'s root grant (spec section 5:
 * "the authenticated parent subject must issue the child"), authenticating
 * as the root grant's own subject agent rather than the user session.
 */
export async function createChildGrant(
  state: E2eState,
  org: SeededOrg,
  childAgentId: string,
  overrides: Partial<{ max_amount_minor: number; delegation_allowed: boolean; max_remaining_depth: number }> = {}
): Promise<{ grantId: string }> {
  const grantRes = await fetch(`${state.apiBaseUrl}/v1/grants`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", authorization: `Bearer ${org.agentSecret}` },
    body: JSON.stringify({
      environment: "sandbox",
      principal_id: org.userId,
      subject_agent_id: childAgentId,
      parent_grant_id: org.grantId,
      allowed_actions: ["refund.create"],
      allowed_resource_ids: [],
      unrestricted_resources: true,
      allowed_connector_ids: ["merchant_sandbox"],
      currency: "EUR",
      max_amount_minor: overrides.max_amount_minor ?? 20_000,
      root_budget_limit_minor: null,
      child_budget_limit_minor: null,
      valid_from: null,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      delegation_allowed: overrides.delegation_allowed ?? false,
      max_remaining_depth: overrides.max_remaining_depth ?? 0,
    }),
  });
  if (!grantRes.ok) throw new Error(`createChildGrant failed: ${grantRes.status} ${await grantRes.text()}`);
  const { grant_id: grantId } = await grantRes.json();
  return { grantId };
}

/** Registers a new user account without attaching it to any organization (for Settings' "add existing member" flow). */
export async function registerUser(state: E2eState, emailPrefix: string): Promise<{ email: string; password: string }> {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const password = "another strong password 123";
  await fetch(`${state.apiBaseUrl}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { email, password };
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
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie: org.ownerCookie, "x-organization-id": org.organizationId  },
    body: JSON.stringify({ email, role: "approver" }),
  });
  return { email, password };
}

/**
 * Seeds the fixed "Northstar Commerce" demo organization (idempotent --
 * safe to call from multiple spec files/runs) directly against the api's
 * own database, using the same `seedNorthstarCommerce` helper that
 * `pnpm demo:seed` and the `/v1/demo/runs` route itself use. This is what
 * lets a Demo Lab spec sign in as `owner@northstar.demo` and actually
 * reach the seeded organization on a brand-new, otherwise-empty e2e
 * database -- the route only ever seeds lazily for a session that's
 * already inside that org, so something has to create it first.
 */
export async function seedNorthstarDemo(state: E2eState): Promise<SeedResult & { ownerPassword: string; ownerEmail: string }> {
  const apiPool = new pg.Pool({ connectionString: state.apiDatabaseUrl });
  const apiDb = drizzle(apiPool, { schema: apiSchema });
  let seed: SeedResult;
  try {
    seed = await seedNorthstarCommerce(apiDb);
  } finally {
    await apiPool.end();
  }

  const merchantPool = new pg.Pool({ connectionString: state.merchantMigratorUrl });
  const merchantDb = drizzle(merchantPool, { schema: merchantSchema });
  try {
    await seedMerchantSandbox(merchantDb, seed.organizationId);
  } finally {
    await merchantPool.end();
  }

  return { ...seed, ownerPassword: DEMO_PASSWORD, ownerEmail: DEMO_USERS.owner.email };
}

export async function submitAction(state: E2eState, org: SeededOrg, resourceId: string, amountMinor: number, idempotencyKey: string) {
  const res = await fetch(`${state.apiBaseUrl}/v1/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${org.agentSecret}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ grant_id: org.grantId, connector_id: "merchant_sandbox", action: "refund.create", resource_id: resourceId, arguments: { amount_minor: amountMinor, currency: "EUR", reason: "e2e" } }),
  });
  return res.json();
}
