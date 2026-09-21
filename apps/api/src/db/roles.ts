import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AdminConnection {
  host: string;
  port: number;
  adminUser: string;
  adminPassword: string;
  database: string;
}

export interface RoleCredentials {
  migratorPassword: string;
  appPassword: string;
}

/**
 * Idempotently creates the two-role split required by
 * docs/PRODUCT_SPEC.md section 4: a migrator role that owns the schema
 * (used only for `pnpm migrate`) and a runtime app role that has no
 * BYPASSRLS/superuser attribute and is granted only the DML it needs.
 * Safe to call repeatedly -- every statement is a no-op if already applied.
 */
export async function bootstrapRolesAndDatabase(admin: AdminConnection, creds: RoleCredentials) {
  const client = new Client({
    host: admin.host,
    port: admin.port,
    user: admin.adminUser,
    password: admin.adminPassword,
    database: "postgres",
  });
  await client.connect();
  try {
    await client.query(
      `do $$
       begin
         if not exists (select from pg_roles where rolname = 'trustrail_migrator') then
           create role trustrail_migrator login password '${escapeLiteral(creds.migratorPassword)}' createdb;
         else
           alter role trustrail_migrator password '${escapeLiteral(creds.migratorPassword)}';
         end if;
       end $$;`
    );
    await client.query(
      `do $$
       begin
         if not exists (select from pg_roles where rolname = 'trustrail_app') then
           create role trustrail_app login password '${escapeLiteral(creds.appPassword)}' nosuperuser nocreatedb nocreaterole nobypassrls;
         else
           alter role trustrail_app password '${escapeLiteral(creds.appPassword)}';
         end if;
       end $$;`
    );

    const dbExists = await client.query("select 1 from pg_database where datname = $1", [admin.database]);
    if (dbExists.rowCount === 0) {
      await client.query(`create database ${quoteIdent(admin.database)} owner trustrail_migrator`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Applies RLS policies (rls.sql) and grants the app role exactly the
 * privileges it needs on every table. Must run as trustrail_migrator
 * (the table owner) after the drizzle table migrations have created the
 * tables.
 */
export async function applyRlsAndGrants(migratorConnectionString: string) {
  const client = new Client({ connectionString: migratorConnectionString });
  await client.connect();
  try {
    const rls = readFileSync(path.join(__dirname, "rls.sql"), "utf8");
    await client.query(rls);

    const globalTables = ["organizations", "users", "sessions", "memberships", "signing_keys"];
    const tenantTables = [
      "agents", "agent_credentials", "grants", "policy_bundles", "policy_versions",
      "connectors", "actions", "idempotency_records", "approvals",
      "budget_windows", "budget_reservations", "execution_jobs", "receipts",
      "audit_events", "usage_events", "demo_runs",
    ];
    await client.query("grant usage on schema public to trustrail_app");
    for (const table of [...globalTables, ...tenantTables]) {
      await client.query(`grant select, insert, update, delete on table ${quoteIdent(table)} to trustrail_app`);
    }
  } finally {
    await client.end();
  }
}

function escapeLiteral(value: string): string {
  if (/[';\\]/.test(value)) {
    throw new Error("generated password contained an unexpected character");
  }
  return value;
}

function quoteIdent(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`unsafe identifier: ${value}`);
  }
  return `"${value}"`;
}
