import os from "node:os";
import { loadEnvIntoProcess } from "./lib/env.js";
import { startLocalPostgres, stopLocalPostgres, isInitialised } from "./lib/localPostgres.js";
import { getDb, closePool } from "@trustrail/db";
import { getActiveSigningKey } from "../apps/api/src/gateway/keys.js";
import { createMerchantSandboxConnector } from "../apps/api/src/gateway/merchantSandboxConnector.js";
import { submitAction } from "../apps/api/src/gateway/submitAction.js";
import { seedNorthstarCommerce } from "../apps/api/src/demo/seedNorthstar.js";
import { getDb as getMerchantDb, closePool as closeMerchantPool } from "../apps/merchant-sandbox/src/db/client.js";
import { seedMerchantSandbox } from "../apps/merchant-sandbox/src/seed.js";
import { buildMerchantSandboxApp } from "../apps/merchant-sandbox/src/server.js";
import type { AgentAuthContext } from "../apps/api/src/auth/context.js";
import type { CreateActionRequest } from "@trustrail/contracts";

/**
 * Reproducible benchmark for authorization evaluation latency
 * (docs/PRODUCT_SPEC.md section 16). Measures the full submitAction() call
 * -- grant chain resolution, policy fetch, evaluation, budget reservation,
 * connector dispatch, and receipt issuance -- against a locally-running
 * merchant sandbox, so it includes real dispatch latency, not just
 * evaluation. The spec's target (p95 authorization evaluation < 100ms on
 * seeded local data, EXCLUDING downstream execution) is a narrower measure
 * than what this reports; the breakdown below separates the two so both
 * numbers are visible.
 */
async function main() {
  const env = loadEnvIntoProcess();
  const concurrency = Number(process.argv[2] ?? 4);
  const sampleSize = Number(process.argv[3] ?? 200);

  if (!isInitialised()) {
    console.error("Local database is not set up yet. Run: pnpm setup:local");
    process.exit(1);
  }
  const { owns: ownsLocalPg } = await startLocalPostgres();

  let merchantApp: Awaited<ReturnType<typeof buildMerchantSandboxApp>> | undefined;
  try {
    const db = getDb();
    const seed = await seedNorthstarCommerce(db);

    const merchantBaseUrl = env.MERCHANT_SANDBOX_URL ?? "http://127.0.0.1:4100";
    const gatewaySecret = env.GATEWAY_SHARED_SECRET!;
    let usingOwnMerchant = false;
    try {
      const res = await fetch(`${merchantBaseUrl}/health/live`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) throw new Error("not ok");
    } catch {
      usingOwnMerchant = true;
      const merchantDb = getMerchantDb();
      merchantApp = buildMerchantSandboxApp({ db: merchantDb, gatewaySecret });
      const url = new URL(merchantBaseUrl);
      await merchantApp.listen({ port: Number(url.port), host: url.hostname });
    }

    const merchantDb = getMerchantDb();
    await seedMerchantSandbox(merchantDb, seed.organizationId);

    const signingKey = await getActiveSigningKey(db);
    const connector = createMerchantSandboxConnector({ baseUrl: merchantBaseUrl, gatewaySecret });
    const deps = { connector, signingKey, issuer: env.RECEIPT_ISSUER ?? "trustrail-local" };
    const ctx: AgentAuthContext = { kind: "agent", agentId: seed.supportAgentId, organizationId: seed.organizationId, environment: "sandbox", credentialId: "bench" };

    const durations: number[] = [];
    let errors = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < sampleSize) {
        const i = cursor++;
        const body: CreateActionRequest = {
          grant_id: seed.rootGrantId,
          connector_id: "merchant_sandbox",
          action: "refund.create",
          resource_id: "order_demo_101",
          arguments: { amount_minor: 100, currency: "EUR", reason: "benchmark" },
        };
        const started = process.hrtime.bigint();
        try {
          await submitAction(db, deps, ctx, body, `bench-${Date.now()}-${i}-${Math.random()}`);
        } catch {
          errors++;
        }
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        durations.push(elapsedMs);
      }
    }

    console.log(`Benchmark: ${sampleSize} requests, concurrency ${concurrency}`);
    console.log(`Hardware: ${os.cpus()[0]?.model ?? "unknown"} x${os.cpus().length}, ${Math.round(os.totalmem() / 1e9)}GB RAM, ${os.platform()}/${os.arch()}`);
    console.log(`Merchant sandbox: ${usingOwnMerchant ? "started for this run" : "reused an already-running instance"} at ${merchantBaseUrl}\n`);

    const wallStart = process.hrtime.bigint();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const wallMs = Number(process.hrtime.bigint() - wallStart) / 1_000_000;

    durations.sort((a, b) => a - b);
    const pct = (p: number) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))];
    const errorRate = errors / sampleSize;

    console.log("Full submitAction() latency (includes connector dispatch + receipt signing):");
    console.log(`  p50: ${pct(50)?.toFixed(1)}ms  p95: ${pct(95)?.toFixed(1)}ms  p99: ${pct(99)?.toFixed(1)}ms`);
    console.log(`  min: ${durations[0]?.toFixed(1)}ms  max: ${durations[durations.length - 1]?.toFixed(1)}ms`);
    console.log(`  error rate: ${(errorRate * 100).toFixed(2)}%`);
    console.log(`  throughput: ${(sampleSize / (wallMs / 1000)).toFixed(1)} req/s (wall clock, concurrency=${concurrency})`);
    console.log("\nNote: this is a measured local run on the build machine, not a published performance claim.");
    console.log("The spec's ~100ms p95 target is for evaluation alone, excluding downstream execution -- this number includes dispatch.");
  } finally {
    if (merchantApp) await merchantApp.close();
    await closeMerchantPool();
    await closePool();
    await stopLocalPostgres(ownsLocalPg);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
