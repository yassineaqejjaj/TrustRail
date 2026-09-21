import type { FastifyInstance } from "fastify";
import { and, desc, eq, lt, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { withTenant } from "../db/client.js";
import { actions, receipts, approvals } from "../db/schema.js";
import { agentRoute, userRoute } from "../http/handlers.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { createActionRequestSchema, EXECUTION_STATES, DECISIONS } from "@trustrail/contracts";
import { submitAction, type SubmitActionDeps } from "../gateway/submitAction.js";

const TERMINAL_STATES = new Set(["succeeded", "failed", "denied", "cancelled", "expired"]);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  agent_id: z.string().optional(),
  decision: z.enum(DECISIONS).optional(),
  execution_state: z.enum(EXECUTION_STATES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function registerActionRoutes(app: FastifyInstance, db: Db, deps: SubmitActionDeps) {
  app.post(
    "/v1/actions",
    agentRoute(db, async (ctx, req, reply) => {
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
        return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "Idempotency-Key header is required"));
      }
      const body = createActionRequestSchema.safeParse(req.body);
      if (!body.success) {
        return sendApiError(reply, req, new ApiError(422, "BAD_REQUEST", "invalid action request", { issues: body.error.issues }));
      }

      const result = await submitAction(db, deps, ctx, body.data, idempotencyKey);
      const status = result.replay
        ? TERMINAL_STATES.has(result.action.executionState) ? 200 : 202
        : result.action.executionState === "denied"
          ? 200
          : TERMINAL_STATES.has(result.action.executionState)
            ? 200
            : 202;
      return reply.code(status).send(await serializeAction(db, ctx.organizationId, result.action));
    })
  );

  app.get(
    "/v1/actions",
    userRoute(db, async (ctx, req, reply) => {
      const q = listQuerySchema.safeParse(req.query);
      if (!q.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid query"));

      const conditions = [eq(actions.organizationId, ctx.organizationId)];
      if (q.data.agent_id) conditions.push(eq(actions.actorAgentId, q.data.agent_id));
      if (q.data.decision) conditions.push(eq(actions.decision, q.data.decision));
      if (q.data.execution_state) conditions.push(eq(actions.executionState, q.data.execution_state));
      if (q.data.from) conditions.push(gte(actions.createdAt, new Date(q.data.from)));
      if (q.data.to) conditions.push(lte(actions.createdAt, new Date(q.data.to)));
      if (q.data.cursor) conditions.push(lt(actions.createdAt, new Date(q.data.cursor)));

      const rows = await withTenant(db, ctx.organizationId, (tx) =>
        tx.select().from(actions).where(and(...conditions)).orderBy(desc(actions.createdAt)).limit(q.data.limit)
      );
      const nextCursor = rows.length === q.data.limit ? rows[rows.length - 1]!.createdAt.toISOString() : null;
      return { actions: rows.map(serializeActionSummary), next_cursor: nextCursor };
    })
  );

  app.get(
    "/v1/actions/:id",
    userRoute(db, async (ctx, req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid action id"));
      const rows = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(actions).where(and(eq(actions.id, params.data.id), eq(actions.organizationId, ctx.organizationId))).limit(1));
      const action = rows[0];
      if (!action) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "action not found"));
      return serializeAction(db, ctx.organizationId, action);
    })
  );
}

function serializeActionSummary(a: typeof actions.$inferSelect) {
  return {
    action_id: a.id,
    action: a.action,
    resource_id: a.resourceId,
    actor_agent_id: a.actorAgentId,
    grant_id: a.grantId,
    decision: a.decision,
    execution_state: a.executionState,
    reason_codes: a.reasonCodes,
    amount_minor: (a.arguments as { amount_minor: number }).amount_minor,
    currency: (a.arguments as { currency: string }).currency,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

async function serializeAction(db: Db, organizationId: string, a: typeof actions.$inferSelect) {
  const [receiptRows, approvalRows] = await withTenant(db, organizationId, async (tx) => {
    const r = await tx.select().from(receipts).where(eq(receipts.actionId, a.id));
    const ap = a.approvalId ? await tx.select().from(approvals).where(eq(approvals.id, a.approvalId)) : [];
    return [r, ap] as const;
  });

  return {
    ...serializeActionSummary(a),
    environment: a.environment,
    connector_id: a.connectorId,
    connector_reference: a.connectorReference,
    root_grant_id: a.rootGrantId,
    principal_id: a.principalId,
    policy_version_id: a.policyVersionId,
    policy_hash: a.policyHash,
    request_hash: a.requestHash,
    trace_id: a.traceId,
    approval: approvalRows[0]
      ? {
          approval_id: approvalRows[0].id,
          status: approvalRows[0].status,
          expires_at: approvalRows[0].expiresAt,
          reviewer_user_id: approvalRows[0].reviewerUserId,
          decided_at: approvalRows[0].decidedAt,
        }
      : null,
    receipts: receiptRows.map((r) => ({ receipt_id: r.id, receipt_type: r.receiptType, created_at: r.createdAt })),
  };
}
