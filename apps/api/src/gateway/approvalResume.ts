import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { withTenant } from "../db/client.js";
import { actions, approvals, executionJobs } from "../db/schema.js";
import { newId } from "../db/ids.js";
import { evaluate } from "@trustrail/policy-engine";
import type { ReasonCode } from "@trustrail/contracts";
import { resolveGrantChain } from "./grantChain.js";
import { getActivePolicy } from "./policyLookup.js";
import { getBudgetTargets, reserveBudgets, utcDateString, BudgetExceededError } from "./budget.js";
import { issueReceipt } from "./receiptBuilder.js";
import { dispatchAction, type DispatchDeps } from "./dispatch.js";
import type { UserAuthContext } from "../auth/context.js";
import { ApiError } from "../http/errors.js";
import { writeAuditEvent } from "./audit.js";
import type { Connector } from "./connector.js";

export interface ApprovalDecisionDeps extends DispatchDeps {
  connector: Connector;
}

/**
 * "Double clicks and parallel reviewers cannot double-dispatch" (spec
 * section 8): the status transition is a single atomic
 * `UPDATE ... WHERE status = 'pending'` -- if two requests race, exactly
 * one updates a row and the other gets zero affected rows and a conflict.
 */
export async function decideApproval(
  db: Db,
  deps: ApprovalDecisionDeps,
  ctx: UserAuthContext,
  approvalId: string,
  decision: "approved" | "rejected",
  reviewerReason: string
): Promise<typeof actions.$inferSelect> {
  const casResult = await withTenant(db, ctx.organizationId, async (tx) => {
    const approvalRows = await tx.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
    const approval = approvalRows[0];
    if (!approval) throw new ApiError(404, "NOT_FOUND", "approval not found");

    if (approval.principalId === ctx.userId) {
      throw new ApiError(403, "FORBIDDEN", "an approver cannot approve their own initiated action");
    }

    if (approval.status !== "pending") {
      throw new ApiError(409, "ALREADY_DECIDED", `approval is already ${approval.status}`);
    }
    if (approval.expiresAt.getTime() <= Date.now()) {
      await tx.update(approvals).set({ status: "expired" }).where(eq(approvals.id, approvalId));
      throw new ApiError(409, "APPROVAL_EXPIRED", "the approval window has expired; the action must be resubmitted");
    }

    const updated = await tx.execute(sql`
      update approvals set status = ${decision}, reviewer_user_id = ${ctx.userId}, reviewer_reason = ${reviewerReason}, decided_at = now()
      where id = ${approvalId} and status = 'pending'
      returning id
    `);
    const affected = (updated as unknown as { rowCount: number }).rowCount ?? (updated as unknown as { rows: unknown[] }).rows?.length ?? 0;
    if (affected === 0) {
      throw new ApiError(409, "ALREADY_DECIDED", "another reviewer already decided this approval");
    }

    return { approval };
  });

  const { approval } = casResult;

  await withTenant(db, ctx.organizationId, (tx) =>
    writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, `approval.${decision}`, { approvalId, actionId: approval.actionId })
  );

  if (decision === "rejected") {
    return finalizeAsDenied(db, deps, ctx.organizationId, approval.actionId, ["APPROVAL_REJECTED"]);
  }

  // decision === "approved": re-evaluate fresh (stale policy invalidates).
  const actionRow = await withTenant(db, ctx.organizationId, async (tx) => {
    const rows = await tx.select().from(actions).where(eq(actions.id, approval.actionId)).limit(1);
    return rows[0] ?? null;
  });
  if (!actionRow) throw new Error("approval points at a missing action");

  const activePolicy = await withTenant(db, ctx.organizationId, (tx) => getActivePolicy(tx, ctx.organizationId, actionRow.environment, actionRow.action));
  if (!activePolicy || activePolicy.policyHash !== approval.policyHash) {
    return finalizeAsDenied(db, deps, ctx.organizationId, approval.actionId, ["APPROVAL_EXPIRED"]);
  }

  const order = await deps.connector.lookupOrder({ organizationId: ctx.organizationId, resourceId: actionRow.resourceId });
  const now = new Date();
  const windowDate = utcDateString(now);
  let denyReason: ReasonCode | null = null;

  try {
    await withTenant(db, ctx.organizationId, async (tx) => {
      const chain = await resolveGrantChain(tx, ctx.organizationId, actionRow.grantId);
      if (!chain) {
        denyReason = "GRANT_REVOKED";
        return;
      }
      const recheck = evaluate({
        now,
        action: actionRow.action as "refund.create",
        resourceId: actionRow.resourceId,
        connectorId: actionRow.connectorId,
        amountMinor: (actionRow.arguments as { amount_minor: number }).amount_minor,
        currency: (actionRow.arguments as { currency: "EUR" }).currency,
        chain,
        order,
        policy: activePolicy.bundle,
        approval: { status: "approved" },
      });
      if (recheck.decision !== "ALLOW") {
        denyReason = recheck.reasonCodes[0] ?? "SCOPE_MISMATCH";
        return;
      }

      const targets = getBudgetTargets(chain, activePolicy.bundle, actionRow.environment);
      await reserveBudgets(tx, ctx.organizationId, windowDate, targets, (actionRow.arguments as { amount_minor: number }).amount_minor, actionRow.id);

      await tx
        .update(actions)
        .set({ decision: "ALLOW", executionState: "reserved", reasonCodes: [], updatedAt: new Date() })
        .where(eq(actions.id, actionRow.id));

      await tx.insert(executionJobs).values({
        id: newId("executionJob"),
        organizationId: ctx.organizationId,
        actionId: actionRow.id,
        status: "pending",
      });

      await issueReceipt(tx, deps.signingKey, {
        receiptType: "decision",
        organizationId: ctx.organizationId,
        environment: actionRow.environment,
        actionId: actionRow.id,
        actorId: actionRow.actorAgentId,
        principalId: actionRow.principalId,
        delegationChainIds: chain.map((g) => g.id),
        action: actionRow.action as "refund.create",
        resourceId: actionRow.resourceId,
        requestHash: actionRow.requestHash,
        policyVersionId: activePolicy.policyVersionId,
        policyHash: activePolicy.policyHash,
        decision: "ALLOW",
        reasonCodes: [],
        approvalId,
        outcome: null,
        connectorReference: null,
        issuer: deps.issuer,
      });
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      denyReason = "BUDGET_EXCEEDED";
    } else {
      throw err;
    }
  }

  if (denyReason) {
    return finalizeAsDenied(db, deps, ctx.organizationId, approval.actionId, [denyReason]);
  }

  await dispatchAction(db, deps, ctx.organizationId, approval.actionId);
  const final = await withTenant(db, ctx.organizationId, async (tx) => {
    const rows = await tx.select().from(actions).where(eq(actions.id, approval.actionId)).limit(1);
    return rows[0]!;
  });
  return final;
}

async function finalizeAsDenied(db: Db, deps: ApprovalDecisionDeps, organizationId: string, actionId: string, reasonCodes: ReasonCode[]) {
  return withTenant(db, organizationId, async (tx) => {
    const rows = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    const actionRow = rows[0];
    if (!actionRow) throw new Error("action not found while finalizing denial");

    await tx.update(actions).set({ decision: "DENY", executionState: "denied", reasonCodes, updatedAt: new Date() }).where(eq(actions.id, actionId));

    await issueReceipt(tx, deps.signingKey, {
      receiptType: "decision",
      organizationId,
      environment: actionRow.environment,
      actionId,
      actorId: actionRow.actorAgentId,
      principalId: actionRow.principalId,
      delegationChainIds: [actionRow.rootGrantId, actionRow.grantId].filter((v, i, arr) => arr.indexOf(v) === i),
      action: actionRow.action as "refund.create",
      resourceId: actionRow.resourceId,
      requestHash: actionRow.requestHash,
      policyVersionId: actionRow.policyVersionId ?? "",
      policyHash: actionRow.policyHash ?? "",
      decision: "DENY",
      reasonCodes,
      approvalId: actionRow.approvalId,
      outcome: null,
      connectorReference: null,
      issuer: deps.issuer,
    });

    const updated = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    return updated[0]!;
  });
}
