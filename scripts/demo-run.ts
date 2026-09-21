import { loadEnvIntoProcess } from "./lib/env.js";
import { startLocalPostgres, stopLocalPostgres, isInitialised } from "./lib/localPostgres.js";
import { getDb, closePool } from "../apps/api/src/db/client.js";
import { getActiveSigningKey } from "../apps/api/src/gateway/keys.js";
import { createMerchantSandboxConnector } from "../apps/api/src/gateway/merchantSandboxConnector.js";
import { seedNorthstarCommerce } from "../apps/api/src/demo/seedNorthstar.js";
import { SCENARIO_KEYS, runScenario, type ScenarioKey } from "../apps/api/src/demo/scenarios.js";
import { getDb as getMerchantDb, closePool as closeMerchantPool } from "../apps/merchant-sandbox/src/db/client.js";
import { seedMerchantSandbox } from "../apps/merchant-sandbox/src/seed.js";
import { buildMerchantSandboxApp } from "../apps/merchant-sandbox/src/server.js";
import type { FastifyInstance } from "fastify";

async function ensureMerchantSandboxRunning(baseUrl: string, gatewaySecret: string): Promise<{ startedOwnInstance: boolean; app?: FastifyInstance }> {
  try {
    const res = await fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) return { startedOwnInstance: false };
  } catch {
    // not running -- start our own for the duration of this script
  }
  console.log("merchant-sandbox is not already running; starting a temporary instance for this run...");
  const merchantDb = getMerchantDb();
  const app = buildMerchantSandboxApp({ db: merchantDb, gatewaySecret });
  const url = new URL(baseUrl);
  await app.listen({ port: Number(url.port), host: url.hostname });
  return { startedOwnInstance: true, app };
}

async function main() {
  const env = loadEnvIntoProcess();
  const scenarioArg = process.argv[2] as ScenarioKey | undefined;
  if (!scenarioArg || !SCENARIO_KEYS.includes(scenarioArg)) {
    console.error(`Usage: pnpm demo:run <scenario>\nAvailable scenarios:\n  ${SCENARIO_KEYS.join("\n  ")}`);
    process.exit(1);
  }
  if (!isInitialised()) {
    console.error("Local database is not set up yet. Run: pnpm setup:local");
    process.exit(1);
  }

  await startLocalPostgres();
  let merchant: { startedOwnInstance: boolean; app?: FastifyInstance } | undefined;

  try {
    const db = getDb();
    const seed = await seedNorthstarCommerce(db);

    const merchantBaseUrl = env.MERCHANT_SANDBOX_URL ?? "http://127.0.0.1:4100";
    const gatewaySecret = env.GATEWAY_SHARED_SECRET!;
    merchant = await ensureMerchantSandboxRunning(merchantBaseUrl, gatewaySecret);

    const merchantDb = getMerchantDb();
    await seedMerchantSandbox(merchantDb, seed.organizationId);

    const signingKey = await getActiveSigningKey(db);
    const connector = createMerchantSandboxConnector({ baseUrl: merchantBaseUrl, gatewaySecret });

    console.log(`\n== Running scenario: ${scenarioArg} ==`);
    const steps = await runScenario(scenarioArg, {
      db,
      seed,
      deps: { connector, signingKey, issuer: env.RECEIPT_ISSUER ?? "trustrail-local" },
      merchantBaseUrl,
      gatewaySecret,
    });

    let allOk = true;
    for (const step of steps) {
      const mark = step.ok ? "PASS" : "FAIL";
      console.log(`  [${mark}] ${step.step}: ${step.description}`);
      if (step.detail) console.log(`         ${JSON.stringify(step.detail)}`);
      if (!step.ok) allOk = false;
    }
    console.log(allOk ? "\nScenario completed as expected.\n" : "\nScenario did NOT complete as expected -- see FAIL steps above.\n");
    if (!allOk) process.exitCode = 1;
  } finally {
    if (merchant?.startedOwnInstance && merchant.app) {
      await merchant.app.close();
    }
    await closeMerchantPool();
    await closePool();
    await stopLocalPostgres();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
