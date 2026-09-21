import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrustRail, TrustRailApiError } from "@trustrail/sdk";
import type { McpAdapterConfig } from "./config.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

/**
 * Exposes exactly three tools, matching docs/PRODUCT_SPEC.md section 12.
 * Every tool call goes through the real TrustRail gateway using the
 * configured agent credential and grant -- there is no local logic here
 * that decides whether a refund is allowed. The deterministic gateway
 * remains the sole authority; this adapter only ever reports what it said
 * ("Never let the model choose whether its own action is allowed").
 */
export function buildMcpServer(config: McpAdapterConfig): McpServer {
  const client = new TrustRail({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const server = new McpServer({ name: "trustrail-mcp-adapter", version: "0.1.0" });

  server.registerTool(
    "get_order",
    {
      title: "Get order",
      description: "Look up an order's remaining refundable balance and status through the TrustRail gateway (read-only; the merchant credential never leaves the gateway).",
      inputSchema: { order_id: z.string().min(1).describe("The order/resource ID, e.g. order_demo_101") },
    },
    async ({ order_id }) => {
      try {
        const resource = await client.connectors.getResource(config.connectorId, order_id);
        return textResult(resource);
      } catch (err) {
        return errorResult(describeError(err));
      }
    }
  );

  server.registerTool(
    "request_refund",
    {
      title: "Request refund",
      description:
        "Request a refund on an order through the TrustRail gateway using the configured delegated grant. The response reflects TrustRail's actual decision (ALLOW/DENY/REQUIRE_APPROVAL) and execution state -- this tool does not itself decide whether the refund is permitted.",
      inputSchema: {
        order_id: z.string().min(1),
        amount_minor: z.number().int().positive().describe("Amount in minor currency units, e.g. 8000 for EUR 80.00"),
        currency: z.literal("EUR"),
        reason: z.string().max(500).default(""),
        idempotency_key: z.string().min(1).describe("Caller-supplied idempotency key; reusing it with the same arguments is safe and returns the same result"),
      },
    },
    async ({ order_id, amount_minor, currency, reason, idempotency_key }) => {
      try {
        const action = await client.actions.execute({
          grantId: config.grantId,
          connectorId: config.connectorId,
          action: "refund.create",
          resourceId: order_id,
          arguments: { amount_minor, currency, reason },
          idempotencyKey: idempotency_key,
        });
        return textResult({
          action_id: action.action_id,
          decision: action.decision,
          execution_state: action.execution_state,
          reason_codes: action.reason_codes,
          connector_reference: action.connector_reference ?? null,
        });
      } catch (err) {
        return errorResult(describeError(err));
      }
    }
  );

  server.registerTool(
    "get_action_status",
    {
      title: "Get action status",
      description: "Check the current decision and execution state of a previously submitted action.",
      inputSchema: { action_id: z.string().min(1) },
    },
    async ({ action_id }) => {
      try {
        const action = await client.actions.get(action_id);
        return textResult({
          action_id: action.action_id,
          decision: action.decision,
          execution_state: action.execution_state,
          reason_codes: action.reason_codes,
          connector_reference: action.connector_reference ?? null,
        });
      } catch (err) {
        return errorResult(describeError(err));
      }
    }
  );

  return server;
}

function describeError(err: unknown): string {
  if (err instanceof TrustRailApiError) {
    return `TrustRail rejected the request: ${err.code} -- ${err.message} (request_id=${err.requestId})`;
  }
  if (err instanceof Error) {
    return `Request to TrustRail failed: ${err.message}. Label this as a connectivity/model-provider error, not a policy decision.`;
  }
  return "Unknown error contacting TrustRail.";
}
