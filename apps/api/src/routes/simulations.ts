import type { FastifyInstance } from "fastify";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { createActionRequestSchema, isMoneyAction } from "@trustrail/contracts";
import { evaluate } from "@trustrail/policy-engine";
import { resolveGrantChain } from "../gateway/grantChain.js";
import { getActivePolicy } from "../gateway/policyLookup.js";
import { resolveConnector, type ConnectorRegistry } from "@trustrail/gateway-core";

/**
 * "Simulation performs no external writes and no reservations. Label its
 * outcome as a prediction, not a transferable authorization" (spec
 * section 6). This calls the exact same evaluate() function actions.ts
 * uses, but never opens a reservation transaction and never calls the
 * connector's write endpoint -- only its read-only resource lookup.
 */
export function registerSimulationRoutes(app: FastifyInstance, db: Db, connectors: ConnectorRegistry) {
  app.post(
    "/v1/simulations",
    userRoute(db, async (ctx, req, reply) => {
      const body = createActionRequestSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid simulation request", { issues: body.error.issues }));

      const chain = await withTenant(db, ctx.organizationId, (tx) => resolveGrantChain(tx, ctx.organizationId, body.data.grant_id));
      const policy = await withTenant(db, ctx.organizationId, (tx) => getActivePolicy(tx, ctx.organizationId, chain?.[0]?.environment ?? "sandbox", body.data.action));
      const connector = resolveConnector(connectors, body.data.connector_id);
      const resource = connector ? await connector.lookupResource({ organizationId: ctx.organizationId, resourceId: body.data.resource_id }) : { found: false as const };
      const money = isMoneyAction(body.data.action);
      const args = body.data.arguments as { amount_minor?: number; currency?: "EUR" };

      const result = !connector
        ? { decision: "DENY" as const, reasonCodes: ["CONNECTOR_UNAVAILABLE" as const], explanation: "connector is not configured", matchedChecks: [], evaluatedValues: {} }
        : chain
          ? evaluate({
              now: new Date(),
              action: body.data.action,
              resourceId: body.data.resource_id,
              connectorId: body.data.connector_id,
              amountMinor: money ? (args.amount_minor ?? 0) : 0,
              currency: money ? (args.currency ?? "EUR") : "EUR",
              arguments: body.data.arguments,
              chain,
              resource,
              policy: policy?.bundle ?? null,
            })
          : { decision: "DENY" as const, reasonCodes: ["GRANT_NOT_FOUND" as const], explanation: "grant not found", matchedChecks: [], evaluatedValues: {} };

      return reply.send({
        prediction: true,
        note: "This is a predicted outcome, not a transferable authorization. No reservation or write occurred.",
        decision: result.decision,
        reason_codes: result.reasonCodes,
        explanation: result.explanation,
        matched_checks: result.matchedChecks,
        evaluated_values: result.evaluatedValues,
      });
    })
  );
}
