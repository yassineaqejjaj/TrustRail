import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { approvals, actions } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { requireRole } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { decideApprovalRequestSchema } from "@trustrail/contracts";
import { decideApproval, type ApprovalDecisionDeps } from "../gateway/approvalResume.js";

export function registerApprovalRoutes(app: FastifyInstance, db: Db, deps: ApprovalDecisionDeps) {
  app.get(
    "/v1/approvals",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "approver");
      const q = z.object({ status: z.enum(["pending", "approved", "rejected", "expired"]).optional() }).safeParse(req.query);
      if (!q.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid query"));

      const conditions = [eq(approvals.organizationId, ctx.organizationId)];
      if (q.data.status) conditions.push(eq(approvals.status, q.data.status));

      const rows = await withTenant(db, ctx.organizationId, async (tx) => {
        const approvalRows = await tx.select().from(approvals).where(and(...conditions)).orderBy(desc(approvals.createdAt)).limit(100);
        const withActions = [];
        for (const a of approvalRows) {
          const actionRows = await tx.select().from(actions).where(eq(actions.id, a.actionId)).limit(1);
          withActions.push({ approval: a, action: actionRows[0] ?? null });
        }
        return withActions;
      });

      return {
        approvals: rows.map(({ approval, action }) => ({
          approval_id: approval.id,
          action_id: approval.actionId,
          principal_id: approval.principalId,
          grant_chain_ids: approval.grantChainIds,
          amount_minor: approval.amountMinor,
          currency: approval.currency,
          triggering_rule: approval.triggeringRule,
          status: approval.status,
          expires_at: approval.expiresAt,
          created_at: approval.createdAt,
          reviewer_user_id: approval.reviewerUserId,
          decided_at: approval.decidedAt,
          action: action
            ? { resource_id: action.resourceId, action: action.action, actor_agent_id: action.actorAgentId, root_grant_id: action.rootGrantId }
            : null,
        })),
      };
    })
  );

  app.post(
    "/v1/approvals/:id/approve",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "approver");
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = decideApprovalRequestSchema.safeParse(req.body ?? {});
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request"));
      try {
        const action = await decideApproval(db, deps, ctx, params.data.id, "approved", body.data.reason);
        return { status: "ok", action_id: action.id, execution_state: action.executionState, decision: action.decision };
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, req, err);
        throw err;
      }
    })
  );

  app.post(
    "/v1/approvals/:id/reject",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "approver");
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = decideApprovalRequestSchema.safeParse(req.body ?? {});
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request"));
      try {
        const action = await decideApproval(db, deps, ctx, params.data.id, "rejected", body.data.reason);
        return { status: "ok", action_id: action.id, execution_state: action.executionState, decision: action.decision };
      } catch (err) {
        if (err instanceof ApiError) return sendApiError(reply, req, err);
        throw err;
      }
    })
  );
}
