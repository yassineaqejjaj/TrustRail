import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { orders, refunds } from "./db/schema.js";
import { createRefund } from "./refund-logic.js";

export interface BuildAppOptions {
  db: Db;
  gatewaySecret: string;
}

const refundRequestSchema = z
  .object({
    organization_id: z.string().min(1),
    order_id: z.string().min(1),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    idempotency_key: z.string().min(1),
  })
  .strict();

/**
 * Every route under /internal requires the gateway shared secret. This
 * simulates the "gateway owns downstream credentials" enforcement boundary
 * from docs/PRODUCT_SPEC.md section 3: in docker-compose this service also
 * has no published host port and sits on a private network, so this header
 * check is defense in depth, not the only control. A request missing or
 * presenting the wrong secret is rejected with 401 regardless of payload
 * shape -- this is what the "agent attempts direct merchant write" demo
 * scenario (section 14) exercises.
 */
export function buildMerchantSandboxApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  void app.register(sensible);

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await opts.db.execute("select 1");
    return { status: "ok" };
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/internal/")) return;
    const provided = req.headers["x-gateway-secret"];
    if (provided !== opts.gatewaySecret) {
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "missing or invalid gateway credential", request_id: req.id });
    }
  });

  app.get("/internal/orders/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const query = z.object({ organization_id: z.string().min(1) }).safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid request", request_id: req.id });
    }
    const rows = await opts.db.select().from(orders).where(eq(orders.id, params.data.id)).limit(1);
    const order = rows[0];
    if (!order || order.organizationId !== query.data.organization_id) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "order not found", request_id: req.id });
    }
    const ageDays = Math.floor((Date.now() - order.placedAt.getTime()) / 86_400_000);
    return {
      order_id: order.id,
      amount_minor: order.amountMinor,
      currency: order.currency,
      original_payment_destination: order.originalPaymentDestination,
      disputed: order.disputed,
      age_days: ageDays,
      customer_ref: order.customerRef,
    };
  });

  app.post("/internal/refunds", async (req, reply) => {
    const body = refundRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid refund request", request_id: req.id });
    }
    const result = await createRefund(opts.db, {
      organizationId: body.data.organization_id,
      orderId: body.data.order_id,
      amountMinor: body.data.amount_minor,
      currency: body.data.currency,
      idempotencyKey: body.data.idempotency_key,
    });

    switch (result.outcome) {
      case "succeeded":
        return reply.code(result.replay ? 200 : 201).send({
          status: "succeeded",
          refund_id: result.refundId,
          destination: result.destination,
          replay: result.replay,
        });
      case "order_not_found":
        return reply.code(404).send({ code: "NOT_FOUND", message: "order not found", request_id: req.id });
      case "currency_mismatch":
        return reply.code(422).send({ code: "CURRENCY_MISMATCH", message: "currency does not match order", request_id: req.id });
      case "insufficient_remaining_balance":
        return reply.code(409).send({
          code: "INSUFFICIENT_REMAINING_BALANCE",
          message: "amount exceeds the order's remaining refundable balance",
          remaining_minor: result.remainingMinor,
          request_id: req.id,
        });
    }
  });

  app.get("/internal/refunds/by-key/:idempotencyKey", async (req, reply) => {
    const params = z.object({ idempotencyKey: z.string() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid request", request_id: req.id });
    }
    const rows = await opts.db.select().from(refunds).where(eq(refunds.idempotencyKey, params.data.idempotencyKey)).limit(1);
    if (!rows[0]) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "refund not found", request_id: req.id });
    }
    return { status: rows[0].status, refund_id: rows[0].id, destination: rows[0].destination };
  });

  return app;
}
