import { getDb } from "./db/client.js";
import { buildMerchantSandboxApp } from "./server.js";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "127.0.0.1"; // loopback only unless explicitly overridden in docker-compose
const gatewaySecret = process.env.GATEWAY_SHARED_SECRET;

if (!gatewaySecret) {
  console.error("GATEWAY_SHARED_SECRET is not set");
  process.exit(1);
}

const app = buildMerchantSandboxApp({ db: getDb(), gatewaySecret });

app
  .listen({ port, host })
  .then(() => console.log(`merchant-sandbox listening on ${host}:${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
