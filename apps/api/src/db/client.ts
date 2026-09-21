import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.APP_DATABASE_URL;
    if (!connectionString) {
      throw new Error("APP_DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export function getDb(): Db {
  return drizzle(getPool(), { schema });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Runs `fn` inside a transaction with `app.current_org_id` pinned via
 * SET LOCAL, so every tenant-scoped RLS policy on every query inside `fn`
 * enforces that exact organization -- see src/db/rls.sql. This is the ONLY
 * sanctioned way to touch a tenant-scoped table; there is no code path
 * that queries those tables without first establishing tenant context.
 *
 * `organizationId` must already have been verified against an
 * authenticated membership or credential by the caller -- this function
 * does not re-verify it, it only enforces it at the database layer.
 */
export async function withTenant<T>(
  db: Db,
  organizationId: string,
  fn: (tx: Db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sqlSetLocal(organizationId));
    return fn(tx as unknown as Db);
  });
}

// drizzle's `sql` template tag would work too, but SET LOCAL cannot take a
// bound parameter placeholder, so we validate and inline defensively.
import { sql } from "drizzle-orm";
function sqlSetLocal(organizationId: string) {
  if (!/^org_[a-zA-Z0-9]{20,}$/.test(organizationId)) {
    throw new Error(`refusing to SET LOCAL app.current_org_id with malformed value`);
  }
  return sql.raw(`SET LOCAL app.current_org_id = '${organizationId}'`);
}
