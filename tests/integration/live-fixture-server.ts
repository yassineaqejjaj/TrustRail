/**
 * Boots a real TrustRail API + merchant-sandbox stack against a real
 * ephemeral PostgreSQL instance, onboards one organization/agent/grant
 * over real HTTP, then prints a single JSON line to stdout describing how
 * to reach it and stays running until killed.
 *
 * Used by sdk/python's live SDK test (tests/test_sdk_live.py) so that test
 * exercises the Python SDK against a genuinely running TrustRail API,
 * without needing a Python-side Postgres/Node bootstrap. Not part of the
 * documented `pnpm` command set -- purely test plumbing.
 */
import { randomBytes } from "node:crypto";
import { startEphemeralPostgres } from "../../packages/test-support/src/index.js";
import { bootstrapRolesAndDatabase } from "../../apps/api/src/db/roles.js";
import { runMigrations } from "../../apps/api/src/db/migrate.js";
import { runMerchantMigrations } from "../../apps/merchant-sandbox/src/db/migrate.js";
import { buildApp } from "../../apps/api/src/server.js";
import { buildMerchantSandboxApp } from "../../apps/merchant-sandbox/src/server.js";
import { createMerchantSandboxConnector } from "../../apps/api/src/gateway/merchantSandboxConnector.js";
import { seedMerchantSandbox } from "../../apps/merchant-sandbox/src/seed.js";
import { generateSigningKeyPair } from "../../packages/receipt-verifier/src/index.js";
import { newId } from "@trustrail/db";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as apiSchema from "@trustrail/db";
import * as merchantSchema from "../../apps/merchant-sandbox/src/db/schema.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
  const pgInstance = await startEphemeralPostgres();
  const gatewaySecret = randomBytes(16).toString("hex");
  const migratorPassword = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");

  await bootstrapRolesAndDatabase(
    { host: pgInstance.host, port: pgInstance.port, adminUser: pgInstance.adminUser, adminPassword: pgInstance.adminPassword, database: "trustrail_py_live" },
    { migratorPassword, appPassword }
  );
  const migratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_py_live`;
  const appUrl = `postgres://trustrail_app:${appPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_py_live`;
  await runMigrations(migratorUrl);

  const apiPool = new pg.Pool({ connectionString: appUrl });
  const apiDb = drizzle(apiPool, { schema: apiSchema });

  const keys = await generateSigningKeyPair();
  const keyDir = mkdtempSync(path.join(tmpdir(), "trustrail-py-live-keys-"));
  const keyPath = path.join(keyDir, `${keys.kid}.json`);
  writeFileSync(keyPath, JSON.stringify(keys.privateJwk));
  await apiDb.insert(apiSchema.signingKeys).values({ id: newId("signingKey"), kid: keys.kid, publicKeyJwk: keys.publicJwk, privateKeyRef: `file:${keyPath}`, status: "active" });

  const merchantMigratorUrl = await pgInstance.createDatabase("merchant_py_live");
  await runMerchantMigrations(merchantMigratorUrl);
  const merchantPool = new pg.Pool({ connectionString: merchantMigratorUrl });
  const merchantDb = drizzle(merchantPool, { schema: merchantSchema });
  const merchantApp = buildMerchantSandboxApp({ db: merchantDb, gatewaySecret });
  await merchantApp.listen({ port: 0, host: "127.0.0.1" });
  const merchantAddr = merchantApp.server.address();
  const merchantBaseUrl = `http://127.0.0.1:${typeof merchantAddr === "object" && merchantAddr ? merchantAddr.port : 0}`;

  const connector = createMerchantSandboxConnector({ baseUrl: merchantBaseUrl, gatewaySecret, timeoutMs: 2000 });
  const config = {
    NODE_ENV: "test", APP_MODE: "demo", PORT: 0, HOST: "127.0.0.1",
    APP_DATABASE_URL: appUrl, SESSION_COOKIE_SECURE: false, MERCHANT_SANDBOX_URL: merchantBaseUrl,
    GATEWAY_SHARED_SECRET: gatewaySecret, RECEIPT_ISSUER: "trustrail-py-live", SIGNING_KEYS_DIR: keyDir,
    CORS_ORIGIN: "http://localhost:3000", isProduction: false, allowDemoEndpoints: true,
  };
  const gatewayDeps = { connector, signingKey: { kid: keys.kid, privateJwk: keys.privateJwk }, issuer: config.RECEIPT_ISSUER };
  const apiApp = buildApp({ db: apiDb, config: config as never, connector, gatewayDeps });
  await apiApp.listen({ port: 0, host: "127.0.0.1" });
  const apiAddr = apiApp.server.address();
  const apiBaseUrl = `http://127.0.0.1:${typeof apiAddr === "object" && apiAddr ? apiAddr.port : 0}`;

  const register = await fetch(`${apiBaseUrl}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "py-live@example.com", password: "correct horse battery staple" }) });
  const cookie = register.headers.get("set-cookie")!.split(";")[0]!;
  const { user_id: userId } = await register.json();
  const orgRes = await fetch(`${apiBaseUrl}/v1/organizations`, { method: "POST", headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie  }, body: JSON.stringify({ name: "Python SDK Live Test" }) });
  const { organization_id: organizationId } = await orgRes.json();
  await seedMerchantSandbox(merchantDb, organizationId);
  const agentRes = await fetch(`${apiBaseUrl}/v1/agents`, { method: "POST", headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie, "x-organization-id": organizationId  }, body: JSON.stringify({ name: "Python SDK Agent", description: "", environment: "sandbox" }) });
  const { agent_id: agentId } = await agentRes.json();
  const credRes = await fetch(`${apiBaseUrl}/v1/agents/${agentId}/credentials`, { method: "POST", headers: { "x-trustrail-csrf": "1", cookie, "x-organization-id": organizationId  } });
  const { secret } = await credRes.json();
  const grantRes = await fetch(`${apiBaseUrl}/v1/grants`, {
    method: "POST",
    headers: { "x-trustrail-csrf": "1", "content-type": "application/json", cookie, "x-organization-id": organizationId  },
    body: JSON.stringify({
      environment: "sandbox", principal_id: userId, subject_agent_id: agentId, parent_grant_id: null,
      allowed_actions: ["refund.create"], allowed_resource_ids: [], unrestricted_resources: true,
      allowed_connector_ids: ["merchant_sandbox"], currency: "EUR", max_amount_minor: 50_000,
      root_budget_limit_minor: 100_000, child_budget_limit_minor: null, valid_from: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), delegation_allowed: false, max_remaining_depth: 0,
    }),
  });
  const { grant_id: grantId } = await grantRes.json();

  console.log(`FIXTURE_READY:${JSON.stringify({ base_url: apiBaseUrl, api_key: secret, grant_id: grantId })}`);

  process.on("SIGTERM", async () => {
    await apiApp.close();
    await merchantApp.close();
    await apiPool.end();
    await merchantPool.end();
    await pgInstance.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
