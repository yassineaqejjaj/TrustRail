/**
 * Bootstraps the trustrail_migrator/trustrail_app role split against a
 * real external Postgres server (as opposed to scripts/setup-local.ts,
 * which manages its own embedded instance), runs all three apps'
 * migrations (trustrail, trustrail_merchant, trustrail_saas), and
 * generates a signing key into the `/keys` volume if none usable exists
 * yet. Mirrors scripts/setup-local.ts's logic; kept separate because this
 * one talks to an already-running Postgres server rather than starting
 * its own.
 *
 * Used two ways:
 * - Docker Compose's one-shot `migrate` service invokes this file
 *   directly (infra/docker-compose.yml) before `api` starts.
 * - `runBootstrapAndMigrate` is also called from apps/api/src/index.ts's
 *   own boot sequence, so a single-process host (no separate pre-deploy
 *   step with reliable volume access, e.g. Railway) can self-migrate.
 *   Everything here is idempotent, so running it from both places on the
 *   same target is redundant but harmless.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { eq } from "drizzle-orm";
import { bootstrapRolesAndDatabase } from "./roles.js";
import { runMigrations } from "./migrate.js";
import { getDb, closePool, signingKeys, newId } from "@trustrail/db";
import { generateSigningKeyPair } from "@trustrail/receipt-verifier";

const KEYS_DIR = process.env.SIGNING_KEYS_DIR ?? "/keys";

export async function runBootstrapAndMigrate(): Promise<void> {
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
  for (const dbName of ["trustrail_merchant", "trustrail_saas"]) {
    const exists = await adminClient.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      await adminClient.query(`create database ${dbName} owner trustrail_migrator`);
    }
  }
  await adminClient.end();

  const migratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${host}:${port}/trustrail`;
  const merchantMigratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${host}:${port}/trustrail_merchant`;
  const saasMigratorUrl = `postgres://trustrail_migrator:${migratorPassword}@${host}:${port}/trustrail_saas`;

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

  console.log("running saas-sandbox migrations...");
  const saasMigratePath = new URL("../../../saas-sandbox/dist/db/migrate.js", import.meta.url).href;
  const saasMigrateModule = (await import(saasMigratePath)) as { runSaasMigrations: (connectionString: string) => Promise<void> };
  await saasMigrateModule.runSaasMigrations(saasMigratorUrl);

  console.log("checking for a signing key...");
  process.env.APP_DATABASE_URL = `postgres://trustrail_app:${appPassword}@${host}:${port}/trustrail`;
  const db = getDb();
  const activeKeys = await db.select().from(signingKeys).where(eq(signingKeys.status, "active"));
  // A DB row alone isn't enough: the private key file lives on a mounted
  // volume that can be replaced (or never actually persisted, e.g. a
  // platform whose pre-deploy step doesn't share the runtime container's
  // volume) independently of the database. Trust only a row whose file is
  // actually present.
  const usableKey = activeKeys.find((k) => k.privateKeyRef.startsWith("file:") && existsSync(k.privateKeyRef.slice("file:".length)));
  if (!usableKey) {
    if (activeKeys.length > 0) {
      await db.update(signingKeys).set({ status: "revoked" }).where(eq(signingKeys.status, "active"));
      console.log(`marked ${activeKeys.length} signing key(s) as revoked -- their private key file is missing on this volume`);
    }
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
    console.log(`found a usable signing key (${usableKey.kid}), leaving it as-is`);
  }

  console.log("migrate service complete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBootstrapAndMigrate()
    .then(closePool)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
