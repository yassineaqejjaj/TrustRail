import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { actions, executionJobs } from "../db/schema.js";
import { withTenant } from "../db/client.js";
import { commitReservations, releaseReservations } from "./budget.js";
import type { Connector } from "./connector.js";
import type { ActiveSigningKey } from "./keys.js";
import { issueReceipt } from "./receiptBuilder.js";
import { assertTransition } from "@trustrail/policy-engine";
import type { ExecutionState } from "@trustrail/contracts";

export interface DispatchDeps {
  connector: Connector;
  signingKey: ActiveSigningKey;
  issuer: string;
}

/**
 * Performs (or retries) the actual downstream dispatch for an action that
 * has already cleared evaluation and holds a budget reservation. This is
 * the one place the connector's write endpoint is called, and it is called
 * with the TrustRail action ID as the connector idempotency key (spec
 * section 7), so a retry after a crash or a worker restart can never
 * double-refund.
 *
 * Called synchronously once right after the reservation transaction
 * commits (for low demo latency) and again later by the worker for any
 * action left in `unknown` or `reserved` without a completed job -- both
 * call sites converge on this same function, so recovery and the happy
 * path share identical logic.
 */
export async function dispatchAction(db: Db, deps: DispatchDeps, organizationId: string, actionId: string): Promise<ExecutionState> {
  return withTenant(db, organizationId, async (tx) => {
    const rows = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    const action = rows[0];
    if (!action) throw new Error(`action ${actionId} not found`);

    let fromState: ExecutionState;
    if (action.executionState === "reserved") {
      assertTransition("reserved", "dispatching");
      await tx.update(actions).set({ executionState: "dispatching", updatedAt: new Date() }).where(eq(actions.id, actionId));
      fromState = "dispatching";
    } else if (action.executionState === "dispatching" || action.executionState === "unknown") {
      fromState = action.executionState;
    } else {
      // Already terminal (succeeded/failed) or not yet reserved -- nothing to do.
      return action.executionState as ExecutionState;
    }

    const outcome = await deps.connector.createRefund({
      organizationId,
      resourceId: action.resourceId,
      amountMinor: (action.arguments as { amount_minor: number }).amount_minor,
      currency: (action.arguments as { currency: "EUR" }).currency,
      idempotencyKey: action.id,
    });

    let finalState: ExecutionState;
    let connectorReference: string | null = null;

    if (outcome.status === "succeeded") {
      finalState = "succeeded";
      connectorReference = outcome.connectorReference;
      await commitReservations(tx, organizationId, actionId);
    } else if (outcome.status === "failed") {
      finalState = "failed";
      await releaseReservations(tx, organizationId, actionId);
    } else {
      finalState = "unknown";
      // Reservation is deliberately NOT released -- "Never free uncertain
      // spending just because a worker lease expires" (spec section 7).
    }

    // A repeated "unknown" outcome across retries is a no-op self-transition,
    // not a new state change -- only assert when the state actually moves.
    if (fromState !== finalState) {
      assertTransition(fromState, finalState);
    }
    await tx
      .update(actions)
      .set({ executionState: finalState, connectorReference, updatedAt: new Date() })
      .where(eq(actions.id, actionId));

    const jobRows = await tx.select().from(executionJobs).where(eq(executionJobs.actionId, actionId)).limit(1);
    const previousAttempts = jobRows[0]?.attemptCount ?? 0;
    await tx
      .update(executionJobs)
      .set({
        status: finalState === "unknown" ? "pending" : finalState === "succeeded" ? "done" : "failed",
        attemptCount: previousAttempts + 1,
        lastError: finalState === "failed" ? "connector rejected the refund" : finalState === "unknown" ? "connector request timed out" : null,
        nextAttemptAt: finalState === "unknown" ? new Date(Date.now() + 5000) : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(executionJobs.actionId, actionId));

    await issueReceipt(tx, deps.signingKey, {
      receiptType: "execution",
      organizationId,
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
      outcome: finalState,
      connectorReference,
      issuer: deps.issuer,
    });

    return finalState;
  });
}
