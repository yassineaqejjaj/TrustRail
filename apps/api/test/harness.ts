import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { startEphemeralPostgres, type EphemeralPostgres } from "@trustrail/test-support";
import { bootstrapRolesAndDatabase, applyRlsAndGrants } from "../src/db/roles.js";
import { runMigrations } from "../src/db/migrate.js";
import * as schema from "@trustrail/db";
import { buildApp } from "../src/server.js";
import type { AppConfig } from "../src/config.js";
import { createMerchantSandboxConnector } from "../src/gateway/merchantSandboxConnector.js";
import { generateSigningKeyPair } from "@trustrail/receipt-verifier";
import { newId } from "@trustrail/db";
import { buildMerchantSandboxApp } from "../../merchant-sandbox/src/server.js";
import { runMerchantMigrations } from "../../merchant-sandbox/src/db/migrate.js";
import { drizzle as drizzleMerchant } from "drizzle-orm/node-postgres";
import * as merchantSchema from "../../merchant-sandbox/src/db/schema.js";
import { seedMerchantSandbox } from "../../merchant-sandbox/src/seed.js";

export interface TestHarness {
  pgInstance: EphemeralPostgres;
  appPool: pg.Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  app: FastifyInstance;
  merchantApp: FastifyInstance;
  merchantBaseUrl: string;
  gatewaySecret: string;
  config: AppConfig;
  signingKey: { kid: string; privateJwk: object };
  seedMerchantOrders(organizationId: string): Promise<void>;
  teardown(): Promise<void>;
}

export async function setupTestHarness(): Promise<TestHarness> {
  const pgInstance = await startEphemeralPostgres();
  const gatewaySecret = randomBytes(16).toString("hex");

  const migratorPassword = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");
  await bootstrapRolesAndDatabase(
    { host: pgInstance.host, port: pgInstance.port, adminUser: pgInstance.adminUser, adminPassword: pgInstance.adminPassword, database: "trustrail_it" },
    { migratorPassword, appPassword }
  );
  const migratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_it`;
  const appUrl = `postgres://trustrail_app:${appPassword}@${pgInstance.host}:${pgInstance.port}/trustrail_it`;
  await runMigrations(migratorUrl);

  const appPool = new pg.Pool({ connectionString: appUrl, max: 10 });
  const db = drizzle(appPool, { schema });

  // Signing key: generate, write private JWK to a temp file, register in DB.
  const keys = await generateSigningKeyPair();
  const keyDir = mkdtempSync(path.join(tmpdir(), "trustrail-keys-"));
  const keyPath = path.join(keyDir, `${keys.kid}.json`);
  writeFileSync(keyPath, JSON.stringify(keys.privateJwk));
  await db.insert(schema.signingKeys).values({
    id: newId("signingKey"),
    kid: keys.kid,
    publicKeyJwk: keys.publicJwk,
    privateKeyRef: `file:${keyPath}`,
    status: "active",
  });

  // Merchant sandbox: its own database on the same ephemeral instance.
  const merchantMigratorUrl = await pgInstance.createDatabase("merchant_it");
  await runMerchantMigrations(merchantMigratorUrl);
  const merchantPool = new pg.Pool({ connectionString: merchantMigratorUrl, max: 5 });
  const merchantDb = drizzleMerchant(merchantPool, { schema: merchantSchema });
  const merchantApp = buildMerchantSandboxApp({ db: merchantDb, gatewaySecret });
  await merchantApp.listen({ port: 0, host: "127.0.0.1" });
  const address = merchantApp.server.address();
  const merchantPort = typeof address === "object" && address ? address.port : 0;
  const merchantBaseUrl = `http://127.0.0.1:${merchantPort}`;

  const config: AppConfig = {
    NODE_ENV: "test",
    APP_MODE: "demo",
    PORT: 0,
    HOST: "127.0.0.1",
    APP_DATABASE_URL: appUrl,
    SESSION_COOKIE_SECURE: false,
    MERCHANT_SANDBOX_URL: merchantBaseUrl,
    GATEWAY_SHARED_SECRET: gatewaySecret,
    RECEIPT_ISSUER: "trustrail-test",
    SIGNING_KEYS_DIR: keyDir,
    CORS_ORIGIN: "http://localhost:3000",
    isProduction: false,
    allowDemoEndpoints: true,
  };

  const connector = createMerchantSandboxConnector({ baseUrl: merchantBaseUrl, gatewaySecret, timeoutMs: 2000 });
  const gatewayDeps = { connector, signingKey: { kid: keys.kid, privateJwk: keys.privateJwk }, issuer: config.RECEIPT_ISSUER };

  const app = buildApp({ db, config, connector, gatewayDeps });
  await app.ready();

  return {
    pgInstance,
    appPool,
    db,
    app,
    merchantApp,
    merchantBaseUrl,
    gatewaySecret,
    config,
    signingKey: { kid: keys.kid, privateJwk: keys.privateJwk },
    async seedMerchantOrders(organizationId: string) {
      await seedMerchantSandbox(merchantDb, organizationId);
    },
    async teardown() {
      await app.close();
      await merchantApp.close();
      await appPool.end();
      await merchantPool.end();
      await pgInstance.stop();
    },
  };
}
