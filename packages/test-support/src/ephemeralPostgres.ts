import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";

export interface EphemeralPostgres {
  /** postgres superuser connection string, database "postgres" */
  adminUrl: string;
  host: string;
  port: number;
  adminUser: string;
  adminPassword: string;
  /** Creates a fresh database and returns a connection string to it. */
  createDatabase(name: string): Promise<string>;
  stop(): Promise<void>;
}

/**
 * Starts a real, disposable PostgreSQL 18 instance for a test run, using
 * `embedded-postgres` (downloads real Postgres binaries, no Docker
 * required -- see docs/DECISIONS.md). Required by
 * docs/PRODUCT_SPEC.md section 16: "Use a real ephemeral PostgreSQL
 * instance for transactions and concurrency; in-memory mocks cannot
 * validate locking behavior."
 */
export async function startEphemeralPostgres(): Promise<EphemeralPostgres> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "trustrail-pg-"));
  const port = 40_000 + Math.floor(Math.random() * 19_000);
  const adminUser = "postgres";
  const adminPassword = "postgres";

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: adminUser,
    password: adminPassword,
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();

  const host = "127.0.0.1";

  return {
    adminUrl: `postgres://${adminUser}:${adminPassword}@${host}:${port}/postgres`,
    host,
    port,
    adminUser,
    adminPassword,
    async createDatabase(name: string) {
      const client = new Client({ host, port, user: adminUser, password: adminPassword, database: "postgres" });
      await client.connect();
      try {
        await client.query(`create database "${name.replace(/[^a-zA-Z0-9_]/g, "")}"`);
      } finally {
        await client.end();
      }
      return `postgres://${adminUser}:${adminPassword}@${host}:${port}/${name}`;
    },
    async stop() {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
