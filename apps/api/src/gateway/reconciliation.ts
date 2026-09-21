import { eq } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { actions, executionJobs } from "@trustrail/db";
import { commitReservations, releaseReservations, issueReceipt, type ActiveSigningKey } from "@trustrail/gateway-core";
import { writeAuditEvent } from "./audit.js";
import { assertTransition } from "@trustrail/policy-engine";
import type { ExecutionState } from "@trustrail/contracts";
import type { UserAuthContext } from "../auth/context.js";
import { ApiError } from "../http/errors.js";

export interface ReconciliationDeps {
  signingKey: ActiveSigningKey;
  issuer: string;
}

export interface ReconciliationItem {
  action_id: string;
  resource_id: string;
  action: string;
  amount_minor: number;
  currency: string;
  actor_agent_id: string;
  attempt_count: number;
  last_error: string | null;
  job_status: string;
  needs_manual_review: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Actions genuinely stuck in `unknown` -- the worker either gave up
 * auto-retrying (job status `stuck`) or is still retrying but has been
 * unresolved long enough to be worth a human's attention. Ordered oldest
 * first: the longest-unresolved case is the most urgent.
 */
export async function listReconciliationItems(db: Db, organizationId: string): Promise<ReconciliationItem[]> {
  return withTenant(db, organizationId, async (tx) => {
    const rows = await tx
      .select({ action: actions, job: executionJobs })
      .from(actions)
      .innerJoin(executionJobs, eq(executionJobs.actionId, actions.id))
      .where(eq(actions.executionState, "unknown"));

    return rows
      .map(({ action, job }) => ({
        action_id: action.id,
        resource_id: action.resourceId,
        action: action.action,
        amount_minor: (action.arguments as { amount_minor: number }).amount_minor,
        currency: (action.arguments as { currency: string }).currency,
        actor_agent_id: action.actorAgentId,
        attempt_count: job.attemptCount,
        last_error: job.lastError,
        job_status: job.status,
        needs_manual_review: job.status === "stuck",
        created_at: action.createdAt,
        updated_at: job.updatedAt,
      }))
      .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime());
  });
}

/**
 * A human resolving an action that never got a definitive answer from the
 * connector -- e.g. they confirmed directly with the merchant that the
 * refund did or didn't actually happen. Reuses the exact same
 * commit/release/receipt/transition logic `dispatchAction` uses for an
 * automated resolution (@trustrail/gateway-core's dispatch.ts), so a manual and an automatic
 * resolution of the same action are indistinguishable in the ledger except
 * for the audit event this records.
 */
export async function resolveReconciliationItem(
  db: Db,
  deps: ReconciliationDeps,
  ctx: UserAuthContext,
  actionId: string,
  outcome: Extract<ExecutionState, "succeeded" | "failed">,
  note: string,
  connectorReference: string | null
): Promise<{ action_id: string; execution_state: ExecutionState }> {
  return withTenant(db, ctx.organizationId, async (tx) => {
    const rows = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    const action = rows[0];
    if (!action) throw new ApiError(404, "NOT_FOUND", "action not found");
    if (action.executionState !== "unknown") {
      throw new ApiError(409, "NOT_RECONCILABLE", `action is in state "${action.executionState}", not "unknown" -- nothing to reconcile`);
    }

    assertTransition("unknown", outcome);

    if (outcome === "succeeded") {
      await commitReservations(tx, ctx.organizationId, actionId);
    } else {
      await releaseReservations(tx, ctx.organizationId, actionId);
    }

    await tx
      .update(actions)
      .set({ executionState: outcome, connectorReference, updatedAt: new Date() })
      .where(eq(actions.id, actionId));

    await tx
      .update(executionJobs)
      .set({ status: outcome === "succeeded" ? "done" : "failed", lastError: `manually reconciled by ${ctx.userId}: ${note}`, updatedAt: new Date() })
      .where(eq(executionJobs.actionId, actionId));

    await issueReceipt(tx, deps.signingKey, {
      receiptType: "execution",
      organizationId: ctx.organizationId,
      environment: action.environment,
      actionId: action.id,
      actorId: action.actorAgentId,
      principalId: action.principalId,
      delegationChainIds: [action.rootGrantId, action.grantId].filter((v, i, arr) => arr.indexOf(v) === i),
      action: action.action as "refund.create",
      resourceId: action.resourceId,
      requestHash: action.requestHash,
      policyVersionId: action.policyVersionId ?? "",
      policyHash: action.policyHash ?? "",
      decision: action.decision as "ALLOW",
      reasonCodes: [],
      approvalId: action.approvalId,
      outcome,
      connectorReference,
      issuer: deps.issuer,
    });

    await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "reconciliation.resolved", {
      actionId,
      outcome,
      note,
      connectorReference,
    });

    return { action_id: actionId, execution_state: outcome };
  });
}
