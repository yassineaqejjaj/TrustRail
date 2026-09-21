import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { ensureEnvFile, ROOT } from "./lib/env.js";
import { startLocalPostgres, stopLocalPostgres, localAdminUrl, LOCAL_PG_PORT, LOCAL_PG_USER, LOCAL_PG_PASSWORD } from "./lib/localPostgres.js";
import { bootstrapRolesAndDatabase } from "../apps/api/src/db/roles.js";
import { runMigrations } from "../apps/api/src/db/migrate.js";
import { runMerchantMigrations } from "../apps/merchant-sandbox/src/db/migrate.js";
import { generateSigningKeyPair } from "@trustrail/receipt-verifier";
import { getDb, closePool } from "../apps/api/src/db/client.js";
import { signingKeys } from "../apps/api/src/db/schema.js";
import { newId } from "../apps/api/src/db/ids.js";

const KEYS_DIR = path.join(ROOT, "infra", "keys");

async function main() {
  console.log("== TrustRail local setup ==");

  const gatewaySecret = randomBytes(24).toString("hex");
  const migratorPassword = randomBytes(16).toString("hex");
  const appPassword = randomBytes(16).toString("hex");

  const env = ensureEnvFile({
    NODE_ENV: "development",
    APP_MODE: "local",
    PORT: "4000",
    HOST: "127.0.0.1",
    WEB_PORT: "3000",
    MERCHANT_SANDBOX_PORT: "4100",
    MERCHANT_SANDBOX_URL: "http://127.0.0.1:4100",
    GATEWAY_SHARED_SECRET: gatewaySecret,
    RECEIPT_ISSUER: "trustrail-local",
    SIGNING_KEYS_DIR: "./infra/keys",
    CORS_ORIGIN: "http://localhost:3000",
    SESSION_COOKIE_SECURE: "false",
    TRUSTRAIL_MIGRATOR_PASSWORD: migratorPassword,
    TRUSTRAIL_APP_PASSWORD: appPassword,
    APP_DATABASE_URL: `postgres://trustrail_app:${appPassword}@127.0.0.1:${LOCAL_PG_PORT}/trustrail`,
    MIGRATOR_DATABASE_URL: `postgres://trustrail_migrator:${migratorPassword}@127.0.0.1:${LOCAL_PG_PORT}/trustrail`,
    MERCHANT_DATABASE_URL: `postgres://trustrail_migrator:${migratorPassword}@127.0.0.1:${LOCAL_PG_PORT}/trustrail_merchant`,
  });

  console.log("starting local PostgreSQL...");
  await startLocalPostgres();

  try {
    console.log("bootstrapping roles and databases (idempotent)...");
    await bootstrapRolesAndDatabase(
      { host: "127.0.0.1", port: LOCAL_PG_PORT, adminUser: LOCAL_PG_USER, adminPassword: LOCAL_PG_PASSWORD, database: "trustrail" },
      { migratorPassword: env.TRUSTRAIL_MIGRATOR_PASSWORD!, appPassword: env.TRUSTRAIL_APP_PASSWORD! }
    );
    // Reuse the same migrator role for the merchant sandbox's own database --
    // it is a synthetic fixture service, not subject to the tenant-RLS
    // mandate that applies to TrustRail's own tables. See docs/DECISIONS.md.
    const adminClient = new pg.Client({ host: "127.0.0.1", port: LOCAL_PG_PORT, user: LOCAL_PG_USER, password: LOCAL_PG_PASSWORD, database: "postgres" });
    await adminClient.connect();
    const exists = await adminClient.query("select 1 from pg_database where datname = 'trustrail_merchant'");
    if (exists.rowCount === 0) {
      await adminClient.query("create database trustrail_merchant owner trustrail_migrator");
    }
    await adminClient.end();

    console.log("running TrustRail migrations + RLS policies...");
    await runMigrations(env.MIGRATOR_DATABASE_URL!);

    console.log("running merchant-sandbox migrations...");
    await runMerchantMigrations(env.MERCHANT_DATABASE_URL!);

    console.log("checking for a signing key...");
    process.env.APP_DATABASE_URL = env.APP_DATABASE_URL;
    const db = getDb();
    const existingKeys = await db.select().from(signingKeys);
    if (existingKeys.length === 0) {
      mkdirSync(KEYS_DIR, { recursive: true });
      const keys = await generateSigningKeyPair();
      const keyPath = path.join(KEYS_DIR, `${keys.kid}.json`);
      writeFileSync(keyPath, JSON.stringify(keys.privateJwk, null, 2), { mode: 0o600 });
      await db.insert(signingKeys).values({
        id: newId("signingKey"),
        kid: keys.kid,
        publicKeyJwk: keys.publicJwk,
        privateKeyRef: `file:${keyPath}`,
        status: "active",
      });
      console.log(`generated signing key ${keys.kid} -> ${keyPath}`);
    } else {
      console.log(`found ${existingKeys.length} existing signing key(s), leaving them as-is`);
    }

    console.log("\nSetup complete. Next: pnpm dev");
  } finally {
    await closePool();
    await stopLocalPostgres();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
