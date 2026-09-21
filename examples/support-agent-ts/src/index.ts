/**
 * A minimal support-agent example: reads a "ticket" (hardcoded here; in a
 * real integration this would come from your helpdesk), decides on a
 * refund amount, and submits it through TrustRail. The deterministic
 * gateway is the sole authority over whether the refund actually happens
 * -- this script cannot make itself the authority even if you wire an LLM
 * into `decideRefundAmount` below (docs/PRODUCT_SPEC.md section 12:
 * "Never let the model choose whether its own action is allowed").
 *
 * Runs without any LLM provider by default. Set SUPPORT_AGENT_USE_LLM=1
 * (and wire your own model call into decideRefundAmount) to experiment
 * with a model proposing the amount/reason -- TrustRail still decides
 * ALLOW/DENY/REQUIRE_APPROVAL regardless of what the model proposed.
 */
import { TrustRail, TrustRailApiError } from "@trustrail/sdk";

const baseUrl = process.env.TRUSTRAIL_BASE_URL ?? "http://localhost:4000";
const apiKey = process.env.TRUSTRAIL_API_KEY;
const grantId = process.env.TRUSTRAIL_GRANT_ID;

if (!apiKey || !grantId) {
  console.error("Set TRUSTRAIL_API_KEY and TRUSTRAIL_GRANT_ID (see docs/SDK_QUICKSTART.md).");
  process.exit(1);
}

interface Ticket {
  orderId: string;
  customerMessage: string;
}

const ticket: Ticket = {
  orderId: process.env.SUPPORT_AGENT_ORDER_ID ?? "order_demo_101",
  customerMessage: "The item arrived damaged, please refund EUR 80.",
};

function decideRefundAmount(t: Ticket): { amountMinor: number; reason: string } {
  // A real integration might call an LLM here to parse the customer
  // message into an amount and reason. The result is still just a
  // *proposal* -- see the module docstring.
  return { amountMinor: 8_000, reason: `Support agent proposal for: "${t.customerMessage}"` };
}

async function main() {
  const client = new TrustRail({ baseUrl, apiKey: apiKey! });
  const { amountMinor, reason } = decideRefundAmount(ticket);

  console.log(`Requesting a EUR ${(amountMinor / 100).toFixed(2)} refund on ${ticket.orderId}...`);

  try {
    const action = await client.actions.execute({
      grantId: grantId!,
      connectorId: "merchant_sandbox",
      action: "refund.create",
      resourceId: ticket.orderId,
      arguments: { amount_minor: amountMinor, currency: "EUR", reason },
      idempotencyKey: `support-agent-${ticket.orderId}-${Date.now()}`,
    });

    switch (action.decision) {
      case "DENY":
        console.log(`Denied: ${action.reason_codes.join(", ")}`);
        return;
      case "REQUIRE_APPROVAL": {
        console.log("Requires human approval; waiting up to 60s for a reviewer...");
        const result = await client.actions.wait(action.action_id, { timeoutMs: 60_000 });
        console.log(`Resolved to: ${result.decision} / ${result.execution_state}`);
        return;
      }
      case "ALLOW": {
        const result = await client.actions.wait(action.action_id, { timeoutMs: 30_000 });
        console.log(`Execution state: ${result.execution_state}, connector reference: ${result.connector_reference ?? "none"}`);
      }
    }
  } catch (err) {
    if (err instanceof TrustRailApiError) {
      console.error(`TrustRail rejected the request: ${err.code} -- ${err.message}`);
    } else {
      throw err;
    }
  }
}

main();
