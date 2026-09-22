import { eq } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { actions, approvals, executionJobs } from "@trustrail/db";
import { newId } from "@trustrail/db";
import { evaluate, type EvaluationResult } from "@trustrail/policy-engine";
import { canonicalActionPayload, canonicalHash, isMoneyAction, type CreateActionRequest, type ReasonCode } from "@trustrail/contracts";
import { resolveGrantChain } from "./grantChain.js";
import { getActivePolicy } from "./policyLookup.js";
import {
  getBudgetTargets,
  reserveBudgets,
  utcDateString,
  BudgetExceededError,
  issueReceipt,
  dispatchAction,
  resolveConnector,
  type DispatchDeps,
} from "@trustrail/gateway-core";
import { checkIdempotency, recordIdempotencyKey, getAction } from "./idempotency.js";
import type { AgentAuthContext } from "../auth/context.js";
import { ApiError } from "../http/errors.js";
import { writeAuditEvent } from "./audit.js";
import { usageEvents } from "@trustrail/db";

export interface SubmitActionDeps extends DispatchDeps {}

/**
 * `body.arguments` is a discriminated shape -- only money actions
 * (refund.create, subscription.grant_credit) carry `amount_minor`/
 * `currency` at all. Every other action has no real amount, so it's
 * evaluated/reserved as 0/1 respectively (see isMoneyAction in
 * @trustrail/contracts and evaluate.ts's own doc comment for why).
 */
function extractAmount(body: CreateActionRequest): { amountMinor: number; currency: "EUR" } {
  if (isMoneyAction(body.action)) {
    const args = body.arguments as { amount_minor: number; currency: "EUR" };
    return { amountMinor: args.amount_minor, currency: args.currency };
  }
  return { amountMinor: 0, currency: "EUR" };
}

/** The unit reserved against shared/daily budgets: the real amount for money actions, a flat 1 (one action) for count-quota actions. */
function reservationAmount(body: CreateActionRequest): number {
  return isMoneyAction(body.action) ? extractAmount(body).amountMinor : 1;
}

export interface SubmitActionResult {
  action: typeof actions.$inferSelect;
  replay: boolean;
}

/**
 * Times the full call and records it as an `authorization` usage event, so
 * GET /v1/metrics/summary reports a measured p50/p95/p99 instead of a
 * hardcoded number (spec section 15/16 benchmark requirement). Wraps
 * submitActionInner, which is the actual gateway logic.
 */
export async function submitAction(
  db: Db,
  deps: SubmitActionDeps,
  ctx: AgentAuthContext,
  body: CreateActionRequest,
  idempotencyKey: string
): Promise<SubmitActionResult> {
  const startedAt = process.hrtime.bigint();
  const result = await submitActionInner(db, deps, ctx, body, idempotencyKey);
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  await withTenant(db, ctx.organizationId, (tx) =>
    tx.insert(usageEvents).values({ id: newId("usageEvent"), organizationId: ctx.organizationId, eventType: "authorization", actionId: result.action.id, latencyMs: Math.round(latencyMs) })
  );
  return result;
}

/**
 * The full trusted execution path from docs/PRODUCT_SPEC.md section 3:
 * authenticated agent -> gateway -> grant/policy evaluation -> budget
 * reservation -> connector dispatch -> merchant response -> signed
 * execution receipt. This function is the gateway.
 */
async function submitActionInner(
  db: Db,
  deps: SubmitActionDeps,
  ctx: AgentAuthContext,
  body: CreateActionRequest,
  idempotencyKey: string
): Promise<SubmitActionResult> {
  const payloadHash = canonicalHash(canonicalActionPayload(body));

  // Every read of a tenant-scoped table (grants, policies, idempotency
  // records, actions) must happen inside a transaction with tenant context
  // set for row-level security to apply -- see db/rls.sql and
  // @trustrail/db's withTenant. This first pass is read-only and separate from
  // the later reservation transaction.
  type FirstPassOutcome =
    | { kind: "conflict" }
    | { kind: "replay"; action: typeof actions.$inferSelect }
    | { kind: "new"; chain: Awaited<ReturnType<typeof resolveGrantChain>>; policy: Awaited<ReturnType<typeof getActivePolicy>> };

  const firstPassOutcome = await withTenant(db, ctx.organizationId, async (tx): Promise<FirstPassOutcome> => {
    const idem = await checkIdempotency(tx, ctx.organizationId, ctx.agentId, idempotencyKey, payloadHash);
    if (idem.kind === "conflict") return { kind: "conflict" };
    if (idem.kind === "replay") {
      const existing = await getAction(tx, idem.actionId);
      if (!existing) throw new Error("idempotency record points at a missing action");
      return { kind: "replay", action: existing };
    }
    const chain = await resolveGrantChain(tx, ctx.organizationId, body.grant_id);
    const policy = await getActivePolicy(tx, ctx.organizationId, ctx.environment, body.action);
    return { kind: "new", chain, policy };
  });

  if (firstPassOutcome.kind === "conflict") {
    throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "idempotency key was already used with a different payload");
  }
  if (firstPassOutcome.kind === "replay") {
    return { action: firstPassOutcome.action, replay: true };
  }

  const { chain, policy } = firstPassOutcome;
  const connector = resolveConnector(deps.connectors, body.connector_id);
  const resource = connector
    ? await connector.lookupResource({ organizationId: ctx.organizationId, resourceId: body.resource_id })
    : { found: false as const };
  const { amountMinor, currency } = extractAmount(body);

  const now = new Date();
  const firstPass: EvaluationResult = !connector
    ? { decision: "DENY", reasonCodes: ["CONNECTOR_UNAVAILABLE"] as ReasonCode[], explanation: "connector is not configured", matchedChecks: [], evaluatedValues: {} }
    : chain
      ? evaluate({
          now,
          action: body.action,
          resourceId: body.resource_id,
          connectorId: body.connector_id,
          amountMinor,
          currency,
          arguments: body.arguments,
          chain,
          resource,
          policy: policy?.bundle ?? null,
        })
      : { decision: "DENY", reasonCodes: ["GRANT_NOT_FOUND"] as ReasonCode[], explanation: "grant not found or not accessible", matchedChecks: [], evaluatedValues: {} };

  const leafGrant = chain?.[chain.length - 1];
  const rootGrantId = chain?.[0]?.id ?? body.grant_id;
  const principalId = leafGrant?.principalId ?? "";

  if (firstPass.decision === "DENY") {
    const action = await persistTerminalAction(db, deps, ctx, body, idempotencyKey, payloadHash, {
      decision: "DENY",
      executionState: "denied",
      reasonCodes: firstPass.reasonCodes,
      policyVersionId: policy?.policyVersionId ?? null,
      policyHash: policy?.policyHash ?? null,
      rootGrantId,
      principalId,
    });
    return { action, replay: false };
  }

  if (firstPass.decision === "REQUIRE_APPROVAL") {
    if (!policy) throw new Error("unreachable: REQUIRE_APPROVAL without a policy");
    const action = await persistAwaitingApproval(db, deps, ctx, body, idempotencyKey, payloadHash, {
      chainIds: (chain ?? []).map((g) => g.id),
      policyVersionId: policy.policyVersionId,
      policyHash: policy.policyHash,
      rootGrantId,
      principalId,
      approvalTtlSeconds: policy.bundle.approval_ttl_seconds,
    });
    return { action, replay: false };
  }

  // ALLOW path: recheck inside the reservation transaction, then reserve and
  // create the durable dispatch job atomically.
  if (!chain || !policy) throw new Error("unreachable: ALLOW without chain/policy");

  const actionId = newId("action");
  const windowDate = utcDateString(now);

  let denyReason: ReasonCode | null = null;

  try {
    await withTenant(db, ctx.organizationId, async (tx) => {
      const recheckChain = await resolveGrantChain(tx, ctx.organizationId, body.grant_id);
      const recheckPolicy = await getActivePolicy(tx, ctx.organizationId, ctx.environment, body.action);
      if (!recheckChain || !recheckPolicy) {
        denyReason = "GRANT_REVOKED";
        return;
      }
      const recheck = evaluate({
        now: new Date(),
        action: body.action,
        resourceId: body.resource_id,
        connectorId: body.connector_id,
        amountMinor,
        currency,
        arguments: body.arguments,
        chain: recheckChain,
        resource,
        policy: recheckPolicy.bundle,
      });
      if (recheck.decision !== "ALLOW") {
        denyReason = recheck.reasonCodes[0] ?? "SCOPE_MISMATCH";
        return;
      }

      const targets = getBudgetTargets(recheckChain, recheckPolicy.bundle, ctx.environment);
      await reserveBudgets(tx, ctx.organizationId, windowDate, targets, reservationAmount(body), actionId);

      await tx.insert(actions).values({
        id: actionId,
        organizationId: ctx.organizationId,
        environment: ctx.environment,
        actorAgentId: ctx.agentId,
        grantId: body.grant_id,
        rootGrantId: recheckChain[0]!.id,
        principalId: recheckChain[recheckChain.length - 1]!.principalId,
        connectorId: body.connector_id,
        action: body.action,
        resourceId: body.resource_id,
        arguments: body.arguments,
        requestHash: payloadHash,
        idempotencyKey,
        decision: "ALLOW",
        reasonCodes: [],
        executionState: "reserved",
        policyVersionId: recheckPolicy.policyVersionId,
        policyHash: recheckPolicy.policyHash,
        approvalId: null,
        traceId: actionId,
      });

      await tx.insert(executionJobs).values({
        id: newId("executionJob"),
        organizationId: ctx.organizationId,
        actionId,
        status: "pending",
      });

      await recordIdempotencyKey(tx, ctx.organizationId, ctx.agentId, idempotencyKey, payloadHash, actionId);

      await issueReceipt(tx, deps.signingKey, {
        receiptType: "decision",
        organizationId: ctx.organizationId,
        environment: ctx.environment,
        actionId,
        actorId: ctx.agentId,
        principalId: recheckChain[recheckChain.length - 1]!.principalId,
        delegationChainIds: recheckChain.map((g) => g.id),
        action: body.action,
        resourceId: body.resource_id,
        requestHash: payloadHash,
        policyVersionId: recheckPolicy.policyVersionId,
        policyHash: recheckPolicy.policyHash,
        decision: "ALLOW",
        reasonCodes: [],
        approvalId: null,
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
    const action = await persistTerminalAction(db, deps, ctx, body, idempotencyKey, payloadHash, {
      decision: "DENY",
      executionState: "denied",
      reasonCodes: [denyReason],
      policyVersionId: policy.policyVersionId,
      policyHash: policy.policyHash,
      rootGrantId,
      principalId,
    });
    return { action, replay: false };
  }

  await dispatchAction(db, deps, ctx.organizationId, actionId);
  const finalAction = await withTenant(db, ctx.organizationId, (tx) => getAction(tx, actionId));
  if (!finalAction) throw new Error("action disappeared after dispatch");
  return { action: finalAction, replay: false };
}

async function persistTerminalAction(
  db: Db,
  deps: SubmitActionDeps,
  ctx: AgentAuthContext,
  body: CreateActionRequest,
  idempotencyKey: string,
  payloadHash: string,
  extra: {
    decision: "DENY";
    executionState: "denied";
    reasonCodes: ReasonCode[];
    policyVersionId: string | null;
    policyHash: string | null;
    rootGrantId: string;
    principalId: string;
  }
) {
  const actionId = newId("action");
  await withTenant(db, ctx.organizationId, async (tx) => {
    await tx.insert(actions).values({
      id: actionId,
      organizationId: ctx.organizationId,
      environment: ctx.environment,
      actorAgentId: ctx.agentId,
      grantId: body.grant_id,
      rootGrantId: extra.rootGrantId,
      principalId: extra.principalId,
      connectorId: body.connector_id,
      action: body.action,
      resourceId: body.resource_id,
      arguments: body.arguments,
      requestHash: payloadHash,
      idempotencyKey,
      decision: extra.decision,
      reasonCodes: extra.reasonCodes,
      executionState: extra.executionState,
      policyVersionId: extra.policyVersionId,
      policyHash: extra.policyHash,
      approvalId: null,
      traceId: actionId,
    });
    await recordIdempotencyKey(tx, ctx.organizationId, ctx.agentId, idempotencyKey, payloadHash, actionId);
    await issueReceipt(tx, deps.signingKey, {
      receiptType: "decision",
      organizationId: ctx.organizationId,
      environment: ctx.environment,
      actionId,
      actorId: ctx.agentId,
      principalId: extra.principalId,
      delegationChainIds: [extra.rootGrantId, body.grant_id].filter((v, i, arr) => arr.indexOf(v) === i),
      action: body.action,
      resourceId: body.resource_id,
      requestHash: payloadHash,
      policyVersionId: extra.policyVersionId ?? "",
      policyHash: extra.policyHash ?? "",
      decision: "DENY",
      reasonCodes: extra.reasonCodes,
      approvalId: null,
      outcome: null,
      connectorReference: null,
      issuer: deps.issuer,
    });
    await writeAuditEvent(tx, ctx.organizationId, "agent", ctx.agentId, "action.denied", { actionId, reasonCodes: extra.reasonCodes });
  });
  const action = await withTenant(db, ctx.organizationId, (tx) => getAction(tx, actionId));
  if (!action) throw new Error("action disappeared after insert");
  return action;
}

async function persistAwaitingApproval(
  db: Db,
  deps: SubmitActionDeps,
  ctx: AgentAuthContext,
  body: CreateActionRequest,
  idempotencyKey: string,
  payloadHash: string,
  extra: {
    chainIds: string[];
    policyVersionId: string;
    policyHash: string;
    rootGrantId: string;
    principalId: string;
    approvalTtlSeconds: number;
  }
) {
  const actionId = newId("action");
  const approvalId = newId("approval");
  const expiresAt = new Date(Date.now() + extra.approvalTtlSeconds * 1000);

  await withTenant(db, ctx.organizationId, async (tx) => {
    await tx.insert(actions).values({
      id: actionId,
      organizationId: ctx.organizationId,
      environment: ctx.environment,
      actorAgentId: ctx.agentId,
      grantId: body.grant_id,
      rootGrantId: extra.rootGrantId,
      principalId: extra.principalId,
      connectorId: body.connector_id,
      action: body.action,
      resourceId: body.resource_id,
      arguments: body.arguments,
      requestHash: payloadHash,
      idempotencyKey,
      decision: "REQUIRE_APPROVAL",
      reasonCodes: ["APPROVAL_REQUIRED"],
      executionState: "awaiting_approval",
      policyVersionId: extra.policyVersionId,
      policyHash: extra.policyHash,
      approvalId,
      traceId: actionId,
    });
    await tx.insert(approvals).values({
      id: approvalId,
      organizationId: ctx.organizationId,
      actionId,
      requestHash: payloadHash,
      principalId: extra.principalId,
      grantChainIds: extra.chainIds,
      policyVersionId: extra.policyVersionId,
      policyHash: extra.policyHash,
      amountMinor: extractAmount(body).amountMinor,
      currency: extractAmount(body).currency,
      triggeringRule: isMoneyAction(body.action) ? "amount_exceeds_automatic_limit" : "not_on_the_automatically_allowed_list",
      status: "pending",
      expiresAt,
    });
    await recordIdempotencyKey(tx, ctx.organizationId, ctx.agentId, idempotencyKey, payloadHash, actionId);
    await issueReceipt(tx, deps.signingKey, {
      receiptType: "decision",
      organizationId: ctx.organizationId,
      environment: ctx.environment,
      actionId,
      actorId: ctx.agentId,
      principalId: extra.principalId,
      delegationChainIds: extra.chainIds,
      action: body.action,
      resourceId: body.resource_id,
      requestHash: payloadHash,
      policyVersionId: extra.policyVersionId,
      policyHash: extra.policyHash,
      decision: "REQUIRE_APPROVAL",
      reasonCodes: ["APPROVAL_REQUIRED"],
      approvalId,
      outcome: null,
      connectorReference: null,
      issuer: deps.issuer,
    });
  });
  const action = await withTenant(db, ctx.organizationId, (tx) => getAction(tx, actionId));
  if (!action) throw new Error("action disappeared after insert");
  return action;
}
