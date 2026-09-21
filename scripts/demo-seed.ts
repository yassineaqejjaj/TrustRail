import { loadEnvIntoProcess } from "./lib/env.js";
import { startLocalPostgres, stopLocalPostgres, isInitialised } from "./lib/localPostgres.js";
import { getDb, closePool } from "@trustrail/db";
import { seedNorthstarCommerce, DEMO_PASSWORD } from "../apps/api/src/demo/seedNorthstar.js";
import { getDb as getMerchantDb, closePool as closeMerchantPool } from "../apps/merchant-sandbox/src/db/client.js";
import { seedMerchantSandbox } from "../apps/merchant-sandbox/src/seed.js";
import { DEMO_USERS } from "@trustrail/contracts";

async function main() {
  // If APP_DATABASE_URL/MERCHANT_DATABASE_URL are already set (e.g. by the
  // caller's shell, to point at a remote database such as a Railway
  // deployment), skip local Postgres entirely -- loadEnvIntoProcess never
  // overwrites an already-set var, so this is safe to call either way.
  const remoteMode = Boolean(process.env.APP_DATABASE_URL && process.env.MERCHANT_DATABASE_URL);
  if (!remoteMode) {
    loadEnvIntoProcess();
    if (!isInitialised()) {
      console.error("Local database is not set up yet. Run: pnpm setup:local");
      process.exit(1);
    }
  }
  const { owns: ownsLocalPg } = remoteMode ? { owns: false } : await startLocalPostgres();
  try {
    const db = getDb();
    const result = await seedNorthstarCommerce(db);

    const merchantDb = getMerchantDb();
    await seedMerchantSandbox(merchantDb, result.organizationId);
    await closeMerchantPool();

    console.log("\n== Northstar Commerce demo seeded (including synthetic merchant orders) ==");
    console.log(`organization_id: ${result.organizationId}\n`);
    console.log("Sign in at the dashboard with any of these (password is the same for all):");
    for (const [key, def] of Object.entries(DEMO_USERS)) {
      console.log(`  ${def.role.padEnd(9)} ${def.email}`);
    }
    console.log(`  password: ${DEMO_PASSWORD}\n`);
    console.log("Agent credentials (shown once -- save them if you need to call the API directly):");
    console.log(`  Support Agent (${result.supportAgentId}): ${result.supportAgentSecret}`);
    console.log(`  Refund Agent  (${result.refundAgentId}): ${result.refundAgentSecret}`);
    console.log(`\nRoot grant:  ${result.rootGrantId}`);
    console.log(`Child grant: ${result.childGrantId}`);
    console.log("\nNext: pnpm dev, then sign in and open the Demo Lab page, or run `pnpm demo:run <scenario>`.");
  } finally {
    await closePool();
    await stopLocalPostgres(ownsLocalPg);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
