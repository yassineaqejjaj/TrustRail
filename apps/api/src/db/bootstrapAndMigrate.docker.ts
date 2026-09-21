/**
 * Docker Compose's one-shot `migrate` service entrypoint
 * (infra/docker-compose.yml). Bootstraps the trustrail_migrator/
 * trustrail_app role split against a real external Postgres container
 * (as opposed to scripts/setup-local.ts, which manages its own embedded
 * instance), runs both apps' migrations, and generates a signing key into
 * the shared `/keys` volume if none exists yet. Mirrors
 * scripts/setup-local.ts's logic; kept separate because this one talks to
 * an already-running Postgres server rather than starting its own.
 *
 * NOT executed on the machine this was authored on (no Docker available
 * there) -- see docs/BUILD_STATUS.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { bootstrapRolesAndDatabase } from "./roles.js";
import { runMigrations } from "./migrate.js";
import { getDb, closePool } from "./client.js";
import { signingKeys } from "./schema.js";
import { newId } from "./ids.js";
import { generateSigningKeyPair } from "@trustrail/receipt-verifier";

const KEYS_DIR = process.env.SIGNING_KEYS_DIR ?? "/keys";

async function main() {
  const host = process.env.POSTGRES_HOST ?? "postgres";
  const port = Number(process.env.POSTGRES_PORT ?? 5432);
  const superuserPassword = process.env.POSTGRES_SUPERUSER_PASSWORD;
  const migratorPassword = process.env.TRUSTRAIL_MIGRATOR_PASSWORD;
  const appPassword = process.env.TRUSTRAIL_APP_PASSWORD;
  if (!superuserPassword || !migratorPassword || !appPassword) {
    throw new Error("POSTGRES_SUPERUSER_PASSWORD, TRUSTRAIL_MIGRATOR_PASSWORD, and TRUSTRAIL_APP_PASSWORD are all required");
  }

  console.log("bootstrapping roles and the trustrail database...");
  await bootstrapRolesAndDatabase(
    { host, port, adminUser: "postgres", adminPassword: superuserPassword, database: "trustrail" },
    { migratorPassword, appPassword }
  );

  const adminClient = new pg.Client({ host, port, user: "postgres", password: superuserPassword, database: "postgres" });
  await adminClient.connect();
  const exists = await adminClient.query("select 1 from pg_database where datname = 'trustrail_merchant'");
  if (exists.rowCount === 0) {
    await adminClient.query("create database trustrail_merchant owner trustrail_migrator");
  }
  await adminClient.end();

  const migratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${host}:${port}/trustrail`;
  const merchantMigratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${host}:${port}/trustrail_merchant`;

  console.log("running TrustRail migrations + RLS policies...");
  await runMigrations(migratorUrl);

  console.log("running merchant-sandbox migrations...");
  // Imported via a computed specifier (not a string literal) so
  // TypeScript's rootDir check doesn't try to include
  // apps/merchant-sandbox/src in apps/api's own compilation -- this is the
  // one deliberate cross-app coupling in this codebase, confined to this
  // Docker-only entrypoint. See this file's header comment.
  const merchantMigratePath = new URL("../../../merchant-sandbox/dist/db/migrate.js", import.meta.url).href;
  const merchantMigrateModule = (await import(merchantMigratePath)) as { runMerchantMigrations: (connectionString: string) => Promise<void> };
  await merchantMigrateModule.runMerchantMigrations(merchantMigratorUrl);

  console.log("checking for a signing key...");
  process.env.APP_DATABASE_URL = `postgres://trustrail_app:${appPassword}@${host}:${port}/trustrail`;
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
  await closePool();

  console.log("migrate service complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
