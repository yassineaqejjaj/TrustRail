import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.MERCHANT_DATABASE_URL;
    if (!connectionString) {
      throw new Error("MERCHANT_DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString, max: 10 });
    // See apps/api's @trustrail/db client for why this matters: without
    // it, a dead idle connection (e.g. the database restarting) crashes
    // the whole process instead of just that one connection.
    pool.on("error", (err) => {
      console.error("database pool error (recovered, not fatal):", err);
    });
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
