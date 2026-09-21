import { loadConfig } from "./config.js";
import { getDb } from "./db/client.js";
import { buildApp } from "./server.js";
import { createMerchantSandboxConnector } from "./gateway/merchantSandboxConnector.js";
import { getActiveSigningKey } from "./gateway/keys.js";
import { runWorkerForever } from "./worker/poller.js";

const config = loadConfig();
const db = getDb();

const connector = createMerchantSandboxConnector({ baseUrl: config.MERCHANT_SANDBOX_URL, gatewaySecret: config.GATEWAY_SHARED_SECRET });

async function main() {
  const signingKey = await getActiveSigningKey(db);
  const gatewayDeps = { connector, signingKey, issuer: config.RECEIPT_ISSUER };
  const demoDeps = config.allowDemoEndpoints
    ? { scenarioDeps: { deps: gatewayDeps, merchantBaseUrl: config.MERCHANT_SANDBOX_URL, gatewaySecret: config.GATEWAY_SHARED_SECRET } }
    : undefined;

  const app = buildApp({ db, config, connector, gatewayDeps, demoDeps });

  runWorkerForever(db, gatewayDeps, 2000);

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`trustrail api listening on ${config.HOST}:${config.PORT}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
