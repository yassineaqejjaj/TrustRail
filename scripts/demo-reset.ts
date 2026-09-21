import { loadEnvIntoProcess } from "./lib/env.js";
import { startLocalPostgres, stopLocalPostgres, isInitialised } from "./lib/localPostgres.js";
import { getDb, closePool } from "../apps/api/src/db/client.js";
import { organizations } from "../apps/api/src/db/schema.js";
import { eq } from "drizzle-orm";
import { resetDemoActivity } from "../apps/api/src/demo/reset.js";
import { getDb as getMerchantDb, closePool as closeMerchantPool } from "../apps/merchant-sandbox/src/db/client.js";
import { seedMerchantSandbox } from "../apps/merchant-sandbox/src/seed.js";
import { DEMO_ORGANIZATION_NAME } from "@trustrail/contracts";

/**
 * Local CLI command, not a public endpoint (spec section 14). Clears only
 * the seeded Northstar Commerce organization's activity data (actions,
 * receipts, approvals, budgets, jobs) and re-seeds fresh merchant orders --
 * never touches identity/grants/policy configuration or any other
 * organization.
 */
async function main() {
  loadEnvIntoProcess();
  if (!isInitialised()) {
    console.error("Local database is not set up yet. Run: pnpm setup:local");
    process.exit(1);
  }
  const { owns: ownsLocalPg } = await startLocalPostgres();
  try {
    const db = getDb();
    const rows = await db.select().from(organizations).where(eq(organizations.name, DEMO_ORGANIZATION_NAME)).limit(1);
    const org = rows[0];
    if (!org) {
      console.log("Northstar Commerce has not been seeded yet -- nothing to reset. Run: pnpm demo:seed");
      return;
    }
    await resetDemoActivity(db, org.id);

    const merchantDb = getMerchantDb();
    await seedMerchantSandbox(merchantDb, org.id);
    await closeMerchantPool();

    console.log(`Reset complete for organization ${org.id} (${DEMO_ORGANIZATION_NAME}).`);
  } finally {
    await closePool();
    await stopLocalPostgres(ownsLocalPg);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
