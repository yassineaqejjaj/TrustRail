import { loadConfig } from "./config.js";
import { getDb } from "./db/client.js";
import { buildApp } from "./server.js";
import { createMerchantSandboxConnector } from "./gateway/merchantSandboxConnector.js";
import { getActiveSigningKey } from "./gateway/keys.js";
import { runWorkerForever } from "./worker/poller.js";
import { runBootstrapAndMigrate } from "./db/bootstrapAndMigrate.docker.js";

const config = loadConfig();
const db = getDb();

const connector = createMerchantSandboxConnector({ baseUrl: config.MERCHANT_SANDBOX_URL, gatewaySecret: config.GATEWAY_SHARED_SECRET });

// On a host with no separate migration step that reliably shares this
// service's own persistent volume (e.g. Railway, where a pre-deploy
// command runs in a different container than the one that starts), the
// server bootstraps and migrates itself on boot instead. Everything
// bootstrapAndMigrate.docker.ts does is idempotent, so this is safe to run
// on every boot and safe to run redundantly alongside a platform (like
// Docker Compose) that also runs it as a separate one-shot step. Only
// attempted when the bootstrap-only credentials are actually provided --
// a hardened deployment with its own migration pipeline need not grant its
// long-running server process superuser database access at all.
async function selfMigrateIfConfigured() {
  if (process.env.POSTGRES_SUPERUSER_PASSWORD && process.env.TRUSTRAIL_MIGRATOR_PASSWORD && process.env.TRUSTRAIL_APP_PASSWORD) {
    await runBootstrapAndMigrate();
  }
}

async function main() {
  await selfMigrateIfConfigured();

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
