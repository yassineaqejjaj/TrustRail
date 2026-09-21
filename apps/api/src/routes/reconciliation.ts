import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { requireRole } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { resolveReconciliationRequestSchema } from "@trustrail/contracts";
import { listReconciliationItems, resolveReconciliationItem, type ReconciliationDeps } from "../gateway/reconciliation.js";

export function registerReconciliationRoutes(app: FastifyInstance, db: Db, deps: ReconciliationDeps) {
  app.get(
    "/v1/reconciliation",
    userRoute(db, async (ctx) => {
      requireRole(ctx, "approver");
      const items = await listReconciliationItems(db, ctx.organizationId);
      return { items };
    })
  );

  app.post(
    "/v1/reconciliation/:actionId/resolve",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "approver");
      const params = z.object({ actionId: z.string() }).safeParse(req.params);
      const body = resolveReconciliationRequestSchema.safeParse(req.body ?? {});
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request"));
      try {
        const result = await resolveReconciliationItem(
          db,
          deps,
          ctx,
          params.data.actionId,
          body.data.outcome,
          body.data.note,
          body.data.connector_reference ?? null
        );
        return { status: "ok", ...result };
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, req, err);
        throw err;
      }
    })
  );
}
