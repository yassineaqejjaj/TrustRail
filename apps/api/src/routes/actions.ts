import type { FastifyInstance } from "fastify";
import { and, desc, eq, lt, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { actions, receipts, approvals } from "@trustrail/db";
import { agentRoute, userRoute, handleRouteError } from "../http/handlers.js";
import { authenticateAgent, authenticateUserWithOrg } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { createActionRequestSchema, EXECUTION_STATES, DECISIONS, isMoneyAction, type ActionName } from "@trustrail/contracts";
import { submitAction, type SubmitActionDeps } from "../gateway/submitAction.js";
import { resolveConnector } from "@trustrail/gateway-core";

const TERMINAL_STATES = new Set(["succeeded", "failed", "denied", "cancelled", "expired"]);

export const listQuerySchema = z.object({
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

  /**
   * "Read-only product views fetch merchant state through authorized
   * backend routes" (spec section 4). The gateway still owns the
   * connector credential -- an agent never talks to the merchant sandbox
   * directly, even for a read. Used by the MCP adapter's `get_order` tool
   * and by any agent that needs order facts before deciding what to
   * request.
   */
  app.get(
    "/v1/connectors/:connectorId/resources/:resourceId",
    agentRoute(db, async (ctx, req, reply) => {
      const params = z.object({ connectorId: z.string(), resourceId: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request"));
      const connector = resolveConnector(deps.connectors, params.data.connectorId);
      if (!connector) {
        return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "unknown connector"));
      }
      const resource = await connector.lookupResource({ organizationId: ctx.organizationId, resourceId: params.data.resourceId });
      if (!resource.found) {
        return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "resource not found"));
      }
      // Shape depends on what kind of resource this connector deals in --
      // an order (refunds) and a SaaS account (subscription actions) have
      // different facts worth showing an agent before it decides what to
      // request.
      if (resource.kind === "order") {
        return {
          resource_id: params.data.resourceId,
          kind: "order" as const,
          remaining_amount_minor: resource.remainingAmountMinor,
          currency: resource.currency,
          age_days: resource.ageDays,
          disputed: resource.disputed,
        };
      }
      return {
        resource_id: params.data.resourceId,
        kind: "subscription_account" as const,
        current_plan_id: resource.currentPlanId,
        active_feature_keys: resource.activeFeatureKeys,
        user_count: resource.userCount,
        admin_user_count: resource.adminUserCount,
        suspended: resource.suspended,
        currency: resource.currency,
      };
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

  /**
   * Dual auth: a dashboard user (session + org header) can view any action
   * in their organization, and an agent (bearer credential) can check the
   * status of an action it acted on -- needed by the MCP adapter's
   * `get_action_status` tool, which authenticates as an agent, not a user.
   */
  app.get("/v1/actions/:id", async (req, reply) => {
    try {
      const organizationId = req.headers.authorization ? (await authenticateAgent(db, req)).organizationId : (await authenticateUserWithOrg(db, req)).organizationId;
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid action id"));
      const rows = await withTenant(db, organizationId, (tx) => tx.select().from(actions).where(and(eq(actions.id, params.data.id), eq(actions.organizationId, organizationId))).limit(1));
      const action = rows[0];
      if (!action) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "action not found"));
      return serializeAction(db, organizationId, action);
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  });
}

function serializeActionSummary(a: typeof actions.$inferSelect) {
  // Only refund.create/subscription.grant_credit arguments actually carry
  // amount_minor/currency -- the other action types (change_plan,
  // activate_feature, invite_user) have no notion of an amount at all, so
  // reporting one here (even 0) would falsely imply "this cost nothing"
  // rather than "not applicable".
  const money = isMoneyAction(a.action as ActionName);
  const args = a.arguments as { amount_minor?: number; currency?: string };
  return {
    action_id: a.id,
    action: a.action,
    resource_id: a.resourceId,
    actor_agent_id: a.actorAgentId,
    grant_id: a.grantId,
    decision: a.decision,
    execution_state: a.executionState,
    reason_codes: a.reasonCodes,
    amount_minor: money ? (args.amount_minor ?? null) : null,
    currency: money ? (args.currency ?? null) : null,
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
