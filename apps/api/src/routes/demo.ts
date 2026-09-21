import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { withTenant } from "../db/client.js";
import { demoRuns } from "../db/schema.js";
import { newId } from "../db/ids.js";
import { userRoute } from "../http/handlers.js";
import { requireRole } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import type { AppConfig } from "../config.js";
import { SCENARIO_KEYS, runScenario, type ScenarioContext } from "../demo/scenarios.js";
import { resetDemoActivity } from "../demo/reset.js";
import { seedNorthstarCommerce } from "../demo/seedNorthstar.js";

const runRequestSchema = z.object({ scenario_key: z.enum(SCENARIO_KEYS) }).strict();

export interface DemoRouteDeps {
  scenarioDeps: Omit<ScenarioContext, "seed" | "db">;
}

/**
 * All routes here are local/demo-mode only: "Production mode must reject
 * demo reset and fault-injection endpoints" (spec section 14). Guarded
 * per-request rather than by not registering the routes at all, so a
 * misconfigured production deployment still gets a clear 403 instead of a
 * generic 404.
 */
export function registerDemoRoutes(app: FastifyInstance, db: Db, config: AppConfig, deps: DemoRouteDeps) {
  function assertDemoAllowed(reply: import("fastify").FastifyReply, req: import("fastify").FastifyRequest): boolean {
    if (!config.allowDemoEndpoints) {
      sendApiError(reply, req, new ApiError(403, "DEMO_DISABLED", "demo endpoints are disabled in production mode"));
      return false;
    }
    return true;
  }

  app.post(
    "/v1/demo/runs",
    userRoute(db, async (ctx, req, reply) => {
      if (!assertDemoAllowed(reply, req)) return;
      requireRole(ctx, "operator");
      const body = runRequestSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid scenario_key"));

      const seed = await seedNorthstarCommerce(db);
      if (seed.organizationId !== ctx.organizationId) {
        return sendApiError(
          reply,
          req,
          new ApiError(422, "WRONG_ORGANIZATION", "the demo lab only runs inside the seeded Northstar Commerce organization; run `pnpm demo:seed` and sign in as owner@northstar.demo")
        );
      }

      const runId = newId("demoRun");
      await withTenant(db, ctx.organizationId, (tx) => tx.insert(demoRuns).values({ id: runId, organizationId: ctx.organizationId, scenarioKey: body.data.scenario_key, status: "running", steps: [] }));

      try {
        const steps = await runScenario(body.data.scenario_key, { db, seed, ...deps.scenarioDeps });
        const status = steps.every((s) => s.ok) ? "succeeded" : "failed";
        await withTenant(db, ctx.organizationId, (tx) => tx.update(demoRuns).set({ status, steps, completedAt: new Date() }).where(eq(demoRuns.id, runId)));
        return reply.code(201).send({ run_id: runId, status, steps });
      } catch (err) {
        await withTenant(db, ctx.organizationId, (tx) =>
          tx.update(demoRuns).set({ status: "failed", steps: [{ step: "error", description: (err as Error).message, ok: false }], completedAt: new Date() }).where(eq(demoRuns.id, runId))
        );
        throw err;
      }
    })
  );

  app.get(
    "/v1/demo/runs",
    userRoute(db, async (ctx, req, reply) => {
      if (!assertDemoAllowed(reply, req)) return;
      const rows = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(demoRuns).where(eq(demoRuns.organizationId, ctx.organizationId)).orderBy(desc(demoRuns.createdAt)).limit(50));
      return { runs: rows.map((r) => ({ run_id: r.id, scenario_key: r.scenarioKey, status: r.status, steps: r.steps, created_at: r.createdAt, completed_at: r.completedAt })) };
    })
  );

  app.post(
    "/v1/demo/reset",
    userRoute(db, async (ctx, req, reply) => {
      if (!assertDemoAllowed(reply, req)) return;
      requireRole(ctx, "operator");
      await resetDemoActivity(db, ctx.organizationId);
      return reply.send({ status: "ok" });
    })
  );
}
