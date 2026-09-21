import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { requireRole } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { detectAgentActivityAnomalies } from "../gateway/anomalyDetection.js";

const anomaliesQuerySchema = z.object({
  window_seconds: z.coerce.number().int().positive().max(86_400).optional(),
  threshold: z.coerce.number().int().positive().optional(),
});

export function registerSecurityRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/v1/security/anomalies",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "admin");
      const q = anomaliesQuerySchema.safeParse(req.query);
      if (!q.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid query"));
      const anomalies = await detectAgentActivityAnomalies(db, ctx.organizationId, {
        windowSeconds: q.data.window_seconds,
        threshold: q.data.threshold,
      });
      return { anomalies };
    })
  );
}
