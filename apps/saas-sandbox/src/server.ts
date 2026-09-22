import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { accounts, accountActions } from "./db/schema.js";
import { applyAccountAction } from "./subscription-logic.js";

export interface BuildAppOptions {
  db: Db;
  gatewaySecret: string;
}

const grantCreditActionSchema = z
  .object({
    organization_id: z.string().min(1),
    account_id: z.string().min(1),
    action: z.literal("subscription.grant_credit"),
    arguments: z
      .object({
        amount_minor: z.number().int().positive(),
        currency: z.string().length(3),
        reason: z.string().min(1),
      })
      .strict(),
    idempotency_key: z.string().min(1),
  })
  .strict();

const changePlanActionSchema = z
  .object({
    organization_id: z.string().min(1),
    account_id: z.string().min(1),
    action: z.literal("subscription.change_plan"),
    arguments: z
      .object({
        target_plan: z.string().min(1),
        reason: z.string().min(1),
      })
      .strict(),
    idempotency_key: z.string().min(1),
  })
  .strict();

const activateFeatureActionSchema = z
  .object({
    organization_id: z.string().min(1),
    account_id: z.string().min(1),
    action: z.literal("subscription.activate_feature"),
    arguments: z
      .object({
        feature_key: z.string().min(1),
        reason: z.string().min(1),
      })
      .strict(),
    idempotency_key: z.string().min(1),
  })
  .strict();

const inviteUserActionSchema = z
  .object({
    organization_id: z.string().min(1),
    account_id: z.string().min(1),
    action: z.literal("subscription.invite_user"),
    arguments: z
      .object({
        email: z.string().email(),
        role: z.string().min(1),
        reason: z.string().min(1),
      })
      .strict(),
    idempotency_key: z.string().min(1),
  })
  .strict();

const actionRequestSchema = z.discriminatedUnion("action", [
  grantCreditActionSchema,
  changePlanActionSchema,
  activateFeatureActionSchema,
  inviteUserActionSchema,
]);

/**
 * Every route under /internal requires the gateway shared secret, mirroring
 * apps/merchant-sandbox's own auth hook exactly: same enforcement boundary
 * (docs/PRODUCT_SPEC.md section 3), same defense-in-depth rationale (in
 * docker-compose this service also has no published host port and sits on
 * a private network).
 */
export function buildSaasSandboxApp(opts: BuildAppOptions): FastifyInstance {
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

  app.get("/internal/accounts/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const query = z.object({ organization_id: z.string().min(1) }).safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid request", request_id: req.id });
    }
    const rows = await opts.db.select().from(accounts).where(eq(accounts.id, params.data.id)).limit(1);
    const account = rows[0];
    if (!account || account.organizationId !== query.data.organization_id) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "account not found", request_id: req.id });
    }
    return {
      account_id: account.id,
      organization_id: account.organizationId,
      plan_id: account.planId,
      feature_keys: account.featureKeys,
      user_count: account.userCount,
      admin_user_count: account.adminUserCount,
      suspended: account.suspended,
      currency: account.currency,
    };
  });

  app.post("/internal/actions", async (req, reply) => {
    const body = actionRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid action request", request_id: req.id });
    }

    const common = {
      organizationId: body.data.organization_id,
      accountId: body.data.account_id,
      idempotencyKey: body.data.idempotency_key,
    };
    const data = body.data;
    const result = await applyAccountAction(
      opts.db,
      data.action === "subscription.grant_credit"
        ? { ...common, action: data.action, arguments: data.arguments }
        : data.action === "subscription.change_plan"
          ? { ...common, action: data.action, arguments: data.arguments }
          : data.action === "subscription.activate_feature"
            ? { ...common, action: data.action, arguments: data.arguments }
            : { ...common, action: data.action, arguments: data.arguments }
    );

    switch (result.outcome) {
      case "succeeded":
        return reply.code(result.replay ? 200 : 201).send({
          status: "succeeded",
          reference_id: result.referenceId,
          detail: result.detail,
          replay: result.replay,
        });
      case "account_not_found":
        return reply.code(404).send({ code: "NOT_FOUND", message: "account not found", request_id: req.id });
      case "account_suspended":
        return reply.code(409).send({ code: "ACCOUNT_SUSPENDED", message: "account is suspended", request_id: req.id });
      case "invalid_plan":
        return reply.code(422).send({ code: "INVALID_PLAN", message: "target_plan is not a recognized plan", request_id: req.id });
    }
  });

  app.get("/internal/actions/by-key/:idempotencyKey", async (req, reply) => {
    const params = z.object({ idempotencyKey: z.string() }).safeParse(req.params);
    const query = z.object({ organization_id: z.string().min(1) }).safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid request", request_id: req.id });
    }
    const rows = await opts.db
      .select()
      .from(accountActions)
      .where(and(eq(accountActions.idempotencyKey, params.data.idempotencyKey), eq(accountActions.organizationId, query.data.organization_id)))
      .limit(1);
    if (!rows[0]) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "action not found", request_id: req.id });
    }
    return { status: rows[0].status, reference_id: rows[0].id, detail: rows[0].detail };
  });

  return app;
}
