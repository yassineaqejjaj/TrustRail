import { loadConfig } from "./config.js";
import { getDb } from "@trustrail/db";
import { buildApp } from "./server.js";
import { createMerchantSandboxConnector } from "./gateway/merchantSandboxConnector.js";
import { createSaasSandboxConnector } from "./gateway/saasSandboxConnector.js";
import { getActiveSigningKey } from "./gateway/keys.js";
import { runWorkerForever, type ConnectorRegistry } from "@trustrail/gateway-core";
import { runBootstrapAndMigrate } from "./db/bootstrapAndMigrate.docker.js";

const config = loadConfig();
const db = getDb();

// Two independent downstream systems, one per use case -- refunds go to
// the merchant sandbox, the four subscription actions go to the SaaS
// sandbox. Registered by connector_id so the gateway can dispatch either
// without knowing which is which; see @trustrail/gateway-core's
// resolveConnector.
const connectors: ConnectorRegistry = {
  merchant_sandbox: createMerchantSandboxConnector({ baseUrl: config.MERCHANT_SANDBOX_URL, gatewaySecret: config.GATEWAY_SHARED_SECRET }),
  saas_sandbox: createSaasSandboxConnector({ baseUrl: config.SAAS_SANDBOX_URL, gatewaySecret: config.GATEWAY_SHARED_SECRET }),
};

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
    // The superuser/migrator credentials are only ever needed for this one
    // bootstrap call. Deleting them from this process's own environment
    // afterward doesn't change what a platform operator or host-level
    // compromise could see (they're still in the platform's env var
    // store), but it does shrink the window in which an RCE *in this
    // Node process* -- e.g. a future dependency vulnerability -- could
    // read them out of `process.env` for the remaining lifetime of a
    // long-running server that otherwise never touches them again.
    delete process.env.POSTGRES_SUPERUSER_PASSWORD;
    delete process.env.TRUSTRAIL_MIGRATOR_PASSWORD;
  }
}

async function main() {
  await selfMigrateIfConfigured();

  const signingKey = await getActiveSigningKey(db);
  const gatewayDeps = { connectors, signingKey, issuer: config.RECEIPT_ISSUER };
  const demoDeps = config.allowDemoEndpoints
    ? { scenarioDeps: { deps: gatewayDeps, merchantBaseUrl: config.MERCHANT_SANDBOX_URL, gatewaySecret: config.GATEWAY_SHARED_SECRET } }
    : undefined;

  const app = buildApp({ db, config, connectors, gatewayDeps, demoDeps });

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
