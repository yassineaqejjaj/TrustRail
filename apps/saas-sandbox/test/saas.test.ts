import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { startEphemeralPostgres, type EphemeralPostgres } from "@trustrail/test-support";
import { runSaasMigrations } from "../src/db/migrate.js";
import * as schema from "../src/db/schema.js";
import { buildSaasSandboxApp } from "../src/server.js";
import type { FastifyInstance } from "fastify";

let pgInstance: EphemeralPostgres;
let pool: pg.Pool;
let app: FastifyInstance;
const GATEWAY_SECRET = "test-gateway-secret";
const ORG = "org_test0000000000000001";

beforeAll(async () => {
  pgInstance = await startEphemeralPostgres();
  const dbUrl = await pgInstance.createDatabase("saas_test");
  await runSaasMigrations(dbUrl);
  pool = new pg.Pool({ connectionString: dbUrl });
  const db = drizzle(pool, { schema });

  await db.insert(schema.accounts).values([
    {
      id: "account_t1",
      organizationId: ORG,
      planId: "growth",
      featureKeys: [],
      userCount: 5,
      adminUserCount: 1,
      suspended: false,
      currency: "EUR",
    },
    {
      id: "account_suspended",
      organizationId: ORG,
      planId: "starter",
      featureKeys: [],
      userCount: 2,
      adminUserCount: 1,
      suspended: true,
      currency: "EUR",
    },
    {
      id: "account_with_feature",
      organizationId: ORG,
      planId: "scale",
      featureKeys: ["advanced_reporting"],
      userCount: 10,
      adminUserCount: 2,
      suspended: false,
      currency: "EUR",
    },
  ]);

  app = buildSaasSandboxApp({ db, gatewaySecret: GATEWAY_SECRET });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await pool.end();
  await pgInstance.stop();
});

const authHeaders = { "x-gateway-secret": GATEWAY_SECRET };

describe("gateway credential boundary", () => {
  it("rejects a request without the gateway secret", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/accounts/account_t1?organization_id=${ORG}`,
      headers: { "x-gateway-secret": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a request with the correct secret", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan_id).toBe("growth");
  });
});

describe("account lookup", () => {
  it("returns 404 for an account owned by a different organization", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/accounts/account_t1?organization_id=org_someone_else`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 404 for a missing account", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/accounts/account_does_not_exist?organization_id=${ORG}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("subscription.grant_credit", () => {
  it("succeeds and records a detail message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_t1",
        action: "subscription.grant_credit",
        arguments: { amount_minor: 15_000, currency: "EUR", reason: "goodwill credit" },
        idempotency_key: "idem-credit-1",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("succeeded");
    expect(body.detail).toBe("granted 15000 EUR credit");
    expect(body.replay).toBe(false);
  });
});

describe("subscription.change_plan", () => {
  it("succeeds and updates the account's plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_t1",
        action: "subscription.change_plan",
        arguments: { target_plan: "scale", reason: "upgrade" },
        idempotency_key: "idem-plan-1",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().detail).toBe("plan changed to scale");

    const lookup = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    expect(lookup.json().plan_id).toBe("scale");
  });

  it("rejects a target plan outside the fixed plan-slug list with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_t1",
        action: "subscription.change_plan",
        arguments: { target_plan: "not_a_real_plan", reason: "test" },
        idempotency_key: "idem-plan-invalid",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_PLAN");
  });
});

describe("subscription.activate_feature", () => {
  it("activates a new feature key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_t1",
        action: "subscription.activate_feature",
        arguments: { feature_key: "sso", reason: "enterprise rollout" },
        idempotency_key: "idem-feature-1",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().detail).toBe("feature sso activated");

    const lookup = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    expect(lookup.json().feature_keys).toContain("sso");
  });

  it("is idempotent as a no-op when the feature is already active", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_with_feature",
        action: "subscription.activate_feature",
        arguments: { feature_key: "advanced_reporting", reason: "already on" },
        idempotency_key: "idem-feature-already-active",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().detail).toBe("already active");

    const lookup = await app.inject({
      method: "GET",
      url: `/internal/accounts/account_with_feature?organization_id=${ORG}`,
      headers: authHeaders,
    });
    expect(lookup.json().feature_keys).toEqual(["advanced_reporting"]);
  });
});

describe("subscription.invite_user", () => {
  it("increments user_count for a member invite without touching admin_user_count", async () => {
    const before = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    const beforeCounts = before.json();

    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_t1",
        action: "subscription.invite_user",
        arguments: { email: "lea@example.com", role: "member", reason: "onboarding" },
        idempotency_key: "idem-invite-1",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().detail).toBe("invited lea@example.com as member");

    const after = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    const afterCounts = after.json();
    expect(afterCounts.user_count).toBe(beforeCounts.user_count + 1);
    expect(afterCounts.admin_user_count).toBe(beforeCounts.admin_user_count);
  });

  it("increments both user_count and admin_user_count for an admin invite", async () => {
    const before = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    const beforeCounts = before.json();

    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_t1",
        action: "subscription.invite_user",
        arguments: { email: "admin@example.com", role: "admin", reason: "onboarding" },
        idempotency_key: "idem-invite-admin-1",
      },
    });
    expect(res.statusCode).toBe(201);

    const after = await app.inject({ method: "GET", url: `/internal/accounts/account_t1?organization_id=${ORG}`, headers: authHeaders });
    const afterCounts = after.json();
    expect(afterCounts.user_count).toBe(beforeCounts.user_count + 1);
    expect(afterCounts.admin_user_count).toBe(beforeCounts.admin_user_count + 1);
  });
});

describe("idempotent replay", () => {
  it("the same idempotency key returns the same stored outcome without double-applying the mutation", async () => {
    const payload = {
      organization_id: ORG,
      account_id: "account_t1",
      action: "subscription.grant_credit",
      arguments: { amount_minor: 500, currency: "EUR", reason: "replay test" },
      idempotency_key: "idem-replay-1",
    };
    const first = await app.inject({ method: "POST", url: "/internal/actions", headers: authHeaders, payload });
    const second = await app.inject({ method: "POST", url: "/internal/actions", headers: authHeaders, payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(first.json().reference_id).toBe(second.json().reference_id);
    expect(second.json().replay).toBe(true);
  });

  it("can be looked up by idempotency key afterwards", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/actions/by-key/idem-replay-1?organization_id=${ORG}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("succeeded");
  });

  it("returns 404 for an unknown idempotency key", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/actions/by-key/idem-does-not-exist?organization_id=${ORG}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("suspended account", () => {
  it("rejects any action against a suspended account with 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/actions",
      headers: authHeaders,
      payload: {
        organization_id: ORG,
        account_id: "account_suspended",
        action: "subscription.grant_credit",
        arguments: { amount_minor: 1_000, currency: "EUR", reason: "should not apply" },
        idempotency_key: "idem-suspended-1",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ACCOUNT_SUSPENDED");
  });
});
