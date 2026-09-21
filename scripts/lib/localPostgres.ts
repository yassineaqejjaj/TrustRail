import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.js";

export const LOCAL_PG_DATA_DIR = path.join(ROOT, ".trustrail", "pgdata");
export const LOCAL_PG_PORT = 55_432;
export const LOCAL_PG_USER = "postgres";
export const LOCAL_PG_PASSWORD = "postgres_local_dev_only";

let instance: EmbeddedPostgres | undefined;

/**
 * A persistent (not ephemeral) local PostgreSQL 18 instance, used by
 * `pnpm setup:local` and `pnpm dev` -- as opposed to
 * `@trustrail/test-support`'s ephemeral instances, which are one per test
 * run and always destroyed. Same underlying mechanism (no Docker
 * required), different lifecycle: this one's data directory persists in
 * `.trustrail/pgdata` (gitignored) across restarts.
 */
export function getLocalPostgres(): EmbeddedPostgres {
  if (!instance) {
    instance = new EmbeddedPostgres({
      databaseDir: LOCAL_PG_DATA_DIR,
      user: LOCAL_PG_USER,
      password: LOCAL_PG_PASSWORD,
      port: LOCAL_PG_PORT,
      persistent: true,
    });
  }
  return instance;
}

export function isInitialised(): boolean {
  return existsSync(path.join(LOCAL_PG_DATA_DIR, "PG_VERSION"));
}

export async function startLocalPostgres(): Promise<EmbeddedPostgres> {
  const pg = getLocalPostgres();
  if (!isInitialised()) {
    console.log("initializing local PostgreSQL data directory...");
    await pg.initialise();
  }
  await pg.start();
  return pg;
}

export async function stopLocalPostgres(): Promise<void> {
  if (instance) {
    await instance.stop();
  }
}

export function localAdminUrl(database = "postgres"): string {
  return `postgres://${LOCAL_PG_USER}:${LOCAL_PG_PASSWORD}@127.0.0.1:${LOCAL_PG_PORT}/${database}`;
}
