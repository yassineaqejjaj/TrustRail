import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { startEphemeralPostgres, type EphemeralPostgres } from "@trustrail/test-support";
import { runMerchantMigrations } from "../src/db/migrate.js";
import * as schema from "../src/db/schema.js";
import { buildMerchantSandboxApp } from "../src/server.js";
import type { FastifyInstance } from "fastify";

let pgInstance: EphemeralPostgres;
let pool: pg.Pool;
let app: FastifyInstance;
const GATEWAY_SECRET = "test-gateway-secret";
const ORG = "org_test0000000000000001";

beforeAll(async () => {
  pgInstance = await startEphemeralPostgres();
  const dbUrl = await pgInstance.createDatabase("merchant_test");
  await runMerchantMigrations(dbUrl);
  pool = new pg.Pool({ connectionString: dbUrl });
  const db = drizzle(pool, { schema });

  await db.insert(schema.orders).values({
    id: "order_t1",
    organizationId: ORG,
    customerRef: "cust_1",
    amountMinor: 10_000,
    currency: "EUR",
    originalPaymentDestination: "card_tok_1",
    disputed: false,
    placedAt: new Date(),
  });

  app = buildMerchantSandboxApp({ db, gatewaySecret: GATEWAY_SECRET });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await pool.end();
  await pgInstance.stop();
});

describe("gateway credential boundary", () => {
  it("rejects a request without the gateway secret (simulates a direct agent write attempt)", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/orders/order_t1?organization_id=${ORG}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/orders/order_t1?organization_id=${ORG}`,
      headers: { "x-gateway-secret": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a request with the correct secret", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/orders/order_t1?organization_id=${ORG}`,
      headers: { "x-gateway-secret": GATEWAY_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount_minor).toBe(10_000);
  });
});

describe("refund idempotency", () => {
  it("the same idempotency key + same payload returns the same refund without a second write", async () => {
    const body = { organization_id: ORG, order_id: "order_t1", amount_minor: 3_000, currency: "EUR", idempotency_key: "idem-a" };
    const first = await app.inject({ method: "POST", url: "/internal/refunds", headers: { "x-gateway-secret": GATEWAY_SECRET }, payload: body });
    const second = await app.inject({ method: "POST", url: "/internal/refunds", headers: { "x-gateway-secret": GATEWAY_SECRET }, payload: body });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(first.json().refund_id).toBe(second.json().refund_id);
    expect(second.json().replay).toBe(true);
  });

  it("refuses an amount exceeding the remaining refundable balance", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/refunds",
      headers: { "x-gateway-secret": GATEWAY_SECRET },
      payload: { organization_id: ORG, order_id: "order_t1", amount_minor: 9_000, currency: "EUR", idempotency_key: "idem-toolarge" },
    });
    // order_t1 has 10000 total, 3000 already refunded above -> 7000 remaining
    expect(res.statusCode).toBe(409);
    expect(res.json().remaining_minor).toBe(7_000);
  });
});

describe("concurrency: overrefund prevention", () => {
  it("never lets concurrent refunds exceed the order's remaining balance", async () => {
    const db = drizzle(pool, { schema });
    await db.insert(schema.orders).values({
      id: "order_concurrent",
      organizationId: ORG,
      customerRef: "cust_c",
      amountMinor: 10_000, // exactly EUR 100.00 remaining
      currency: "EUR",
      originalPaymentDestination: "card_tok_c",
      disputed: false,
      placedAt: new Date(),
    });

    const attempts = Array.from({ length: 8 }, (_, i) =>
      app.inject({
        method: "POST",
        url: "/internal/refunds",
        headers: { "x-gateway-secret": GATEWAY_SECRET },
        payload: { organization_id: ORG, order_id: "order_concurrent", amount_minor: 3_000, currency: "EUR", idempotency_key: `idem-concurrent-${i}` },
      })
    );
    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.statusCode === 201);
    const totalCommitted = succeeded.length * 3_000;
    expect(totalCommitted).toBeLessThanOrEqual(10_000);
    // With 8 attempts of 3000 against a 10000 budget, exactly 3 should succeed (9000) and the rest rejected.
    expect(succeeded.length).toBe(3);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(rejected.length).toBe(5);
  });
});

describe("currency and not-found handling", () => {
  it("rejects a refund for a non-existent order", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/refunds",
      headers: { "x-gateway-secret": GATEWAY_SECRET },
      payload: { organization_id: ORG, order_id: "order_missing", amount_minor: 1_000, currency: "EUR", idempotency_key: "idem-missing" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a currency mismatch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/refunds",
      headers: { "x-gateway-secret": GATEWAY_SECRET },
      payload: { organization_id: ORG, order_id: "order_t1", amount_minor: 1_000, currency: "USD", idempotency_key: "idem-usd" },
    });
    expect(res.statusCode).toBe(422);
  });
});
