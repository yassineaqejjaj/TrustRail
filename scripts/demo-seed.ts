import { loadEnvIntoProcess } from "./lib/env.js";
import { startLocalPostgres, stopLocalPostgres, isInitialised } from "./lib/localPostgres.js";
import { getDb, closePool } from "../apps/api/src/db/client.js";
import { seedNorthstarCommerce, DEMO_PASSWORD } from "../apps/api/src/demo/seedNorthstar.js";
import { DEMO_USERS } from "@trustrail/contracts";

async function main() {
  loadEnvIntoProcess();
  if (!isInitialised()) {
    console.error("Local database is not set up yet. Run: pnpm setup:local");
    process.exit(1);
  }
  const { owns: ownsLocalPg } = await startLocalPostgres();
  try {
    const db = getDb();
    const result = await seedNorthstarCommerce(db);

    console.log("\n== Northstar Commerce demo seeded ==");
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
