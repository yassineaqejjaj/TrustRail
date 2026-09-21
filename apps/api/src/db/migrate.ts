import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { applyRlsAndGrants } from "./roles.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(migratorConnectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: migratorConnectionString, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, "..", "..", "migrations") });
    await applyRlsAndGrants(migratorConnectionString);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) {
    console.error("MIGRATOR_DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
