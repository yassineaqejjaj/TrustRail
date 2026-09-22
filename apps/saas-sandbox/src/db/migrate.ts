import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runSaasMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, "..", "..", "migrations") });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.MIGRATOR_DATABASE_URL ?? process.env.SAAS_DATABASE_URL;
  if (!url) {
    console.error("MIGRATOR_DATABASE_URL (or SAAS_DATABASE_URL) is not set");
    process.exit(1);
  }
  runSaasMigrations(url)
    .then(() => {
      console.log("saas-sandbox migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
