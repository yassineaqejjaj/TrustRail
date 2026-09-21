import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import net from "node:net";
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

/** True if something is already listening on the local Postgres port (most likely `pnpm dev`). */
export function isLocalPostgresReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: LOCAL_PG_PORT, timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Starts the local Postgres instance for the duration of this process, OR,
 * if one is already reachable on the configured port (typically because
 * `pnpm dev` is already running in another terminal, per
 * docs/SDK_QUICKSTART.md's documented workflow), reuses it instead of
 * failing with "lock file already exists". The returned `owns` flag tells
 * the caller whether it's responsible for stopping it again.
 */
export async function startLocalPostgres(): Promise<{ pg: EmbeddedPostgres | null; owns: boolean }> {
  if (await isLocalPostgresReachable()) {
    return { pg: null, owns: false };
  }
  const pg = getLocalPostgres();
  if (!isInitialised()) {
    console.log("initializing local PostgreSQL data directory...");
    await pg.initialise();
  }
  await pg.start();
  return { pg, owns: true };
}

export async function stopLocalPostgres(owns = true): Promise<void> {
  if (owns && instance) {
    await instance.stop();
  }
}

export function localAdminUrl(database = "postgres"): string {
  return `postgres://${LOCAL_PG_USER}:${LOCAL_PG_PASSWORD}@127.0.0.1:${LOCAL_PG_PORT}/${database}`;
}
