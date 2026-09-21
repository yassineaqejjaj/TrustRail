/**
 * Boots a real, isolated TrustRail stack for the Playwright suite: a real
 * ephemeral PostgreSQL instance (via @trustrail/test-support), the real
 * merchant-sandbox and api servers listening on real ports, and a real
 * `next dev` process for apps/web pointed at that api instance. Writes
 * connection info to a JSON file (`.e2e-state.json`) that test files read.
 *
 * This is deliberately independent of `pnpm dev`/`pnpm demo:seed` so the
 * suite can run in CI without colliding with a developer's own running
 * stack, and so every run starts from a known-clean database.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startEphemeralPostgres, type EphemeralPostgres } from "@trustrail/test-support";
import { generateSigningKeyPair } from "@trustrail/receipt-verifier";

import { bootstrapRolesAndDatabase } from "../../apps/api/src/db/roles.js";
import { runMigrations } from "../../apps/api/src/db/migrate.js";
import * as apiSchema from "@trustrail/db";
import { buildApp } from "../../apps/api/src/server.js";
import { createMerchantSandboxConnector } from "../../apps/api/src/gateway/merchantSandboxConnector.js";
import { newId } from "@trustrail/db";
import { runMerchantMigrations } from "../../apps/merchant-sandbox/src/db/migrate.js";
import * as merchantSchema from "../../apps/merchant-sandbox/src/db/schema.js";
import { buildMerchantSandboxApp } from "../../apps/merchant-sandbox/src/server.js";
import { seedMerchantSandbox } from "../../apps/merchant-sandbox/src/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const STATE_PATH = path.join(__dirname, ".e2e-state.json");

export interface E2eState {
  apiBaseUrl: string;
  webBaseUrl: string;
  merchantBaseUrl: string;
  gatewaySecret: string;
  /** Lets test files seed merchant orders for whatever org they create, via seedMerchantSandbox. */
  merchantMigratorUrl: string;
  /** Lets test files connect directly to the api's own database (e.g. to call seedNorthstarCommerce for Demo Lab specs) with the same `trustrail_app` role the running api server itself uses. */
  apiDatabaseUrl: string;
}

export default async function globalSetup() {
  let webProcess: ChildProcess | undefined;
  let apiApp: Awaited<ReturnType<typeof buildApp>> | undefined;
  let merchantApp: Awaited<ReturnType<typeof buildMerchantSandboxApp>> | undefined;
  let apiPool: pg.Pool | undefined;
  let merchantPool: pg.Pool | undefined;
  let keyDir: string | undefined;
  const pgInstance = await startEphemeralPostgres();
  const gatewaySecret = randomBytes(16).toString("hex");
  const migratorPassword = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");

  await bootstrapRolesAndDatabase(
    { host: pgInstance.host, port: pgInstance.port, adminUser: pgInstance.adminUser, adminPassword: pgInstance.adminPassword, database: "trustrail_e2e" },
    { migratorPassword, appPassword }
  );
  const migratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_e2e`;
  const appUrl = `postgres://trustrail_app:${appPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_e2e`;
  await runMigrations(migratorUrl);

  apiPool = new pg.Pool({ connectionString: appUrl, max: 10 });
  const apiDb = drizzle(apiPool, { schema: apiSchema });

  const keys = await generateSigningKeyPair();
  keyDir = mkdtempSync(path.join(tmpdir(), "trustrail-e2e-keys-"));
  const keyPath = path.join(keyDir, `${keys.kid}.json`);
  writeFileSync(keyPath, JSON.stringify(keys.privateJwk));
  await apiDb.insert(apiSchema.signingKeys).values({ id: newId("signingKey"), kid: keys.kid, publicKeyJwk: keys.publicJwk, privateKeyRef: `file:${keyPath}`, status: "active" });

  const merchantMigratorUrl = await pgInstance.createDatabase("merchant_e2e");
  await runMerchantMigrations(merchantMigratorUrl);
  merchantPool = new pg.Pool({ connectionString: merchantMigratorUrl, max: 10 });
  const merchantDb = drizzle(merchantPool, { schema: merchantSchema });
  merchantApp = buildMerchantSandboxApp({ db: merchantDb, gatewaySecret });
  await merchantApp.listen({ port: 0, host: "127.0.0.1" });
  const merchantAddr = merchantApp.server.address();
  const merchantBaseUrl = `http://127.0.0.1:${typeof merchantAddr === "object" && merchantAddr ? merchantAddr.port : 0}`;

  const connector = createMerchantSandboxConnector({ baseUrl: merchantBaseUrl, gatewaySecret });
  const config = {
    NODE_ENV: "test", APP_MODE: "demo", PORT: 0, HOST: "127.0.0.1",
    APP_DATABASE_URL: appUrl, SESSION_COOKIE_SECURE: false, MERCHANT_SANDBOX_URL: merchantBaseUrl,
    GATEWAY_SHARED_SECRET: gatewaySecret, RECEIPT_ISSUER: "trustrail-e2e", SIGNING_KEYS_DIR: keyDir,
    CORS_ORIGIN: "http://127.0.0.1:3100", isProduction: false, allowDemoEndpoints: true,
  };
  const gatewayDeps = { connector, signingKey: { kid: keys.kid, privateJwk: keys.privateJwk }, issuer: config.RECEIPT_ISSUER };
  // Mirrors apps/api/src/index.ts's own construction exactly -- without
  // this, buildApp() never registers /v1/demo/* at all (it's conditional
  // on demoDeps being passed), which is what a Demo Lab e2e spec needs.
  const demoDeps = { scenarioDeps: { deps: gatewayDeps, merchantBaseUrl, gatewaySecret } };
  apiApp = buildApp({ db: apiDb, config: config as never, connector, gatewayDeps, demoDeps });
  await apiApp.listen({ port: 0, host: "127.0.0.1" });
  const apiAddr = apiApp.server.address();
  const apiBaseUrl = `http://127.0.0.1:${typeof apiAddr === "object" && apiAddr ? apiAddr.port : 0}`;

  // Seed one merchant order set under a fixed, well-known organization ID
  // isn't possible (IDs are generated) -- instead we seed orders lazily
  // per-organization from within tests that need them, via a helper.

  const webPort = 3100;
  webProcess = spawn("pnpm", ["--filter", "@trustrail/web", "run", "dev"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(webPort), NEXT_PUBLIC_API_BASE_URL: apiBaseUrl },
    stdio: "pipe",
    detached: true, // its own process group, so teardown can kill next dev's child processes too
  });
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  await waitForHttp(`${webBaseUrl}/`, 60_000);

  const state: E2eState = { apiBaseUrl, webBaseUrl, merchantBaseUrl, gatewaySecret, merchantMigratorUrl, apiDatabaseUrl: appUrl };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  // Playwright calls the function a globalSetup returns as teardown, once
  // every test has finished, in this same process/closure -- see
  // https://playwright.dev/docs/test-global-setup-teardown.
  return async function globalTeardown() {
    if (webProcess?.pid) {
      try {
        process.kill(-webProcess.pid, "SIGTERM");
      } catch {
        webProcess.kill("SIGTERM");
      }
    }
    await apiApp?.close();
    await merchantApp?.close();
    await apiPool?.end();
    await merchantPool?.end();
    await pgInstance.stop();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  };
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

