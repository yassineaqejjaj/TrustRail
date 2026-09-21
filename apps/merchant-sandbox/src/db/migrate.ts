import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMerchantMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, "..", "..", "migrations") });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATOR_DATABASE_URL ?? process.env.MERCHANT_DATABASE_URL;
  if (!url) {
    console.error("MIGRATOR_DATABASE_URL (or MERCHANT_DATABASE_URL) is not set");
    process.exit(1);
  }
  runMerchantMigrations(url)
    .then(() => {
      console.log("merchant-sandbox migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
