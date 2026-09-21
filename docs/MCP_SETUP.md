# MCP adapter setup

`packages/mcp-adapter` is a local **stdio** MCP server exposing three tools
backed by the real TrustRail gateway: `get_order`, `request_refund`,
`get_action_status`. It never decides anything itself — every call goes
through `apps/api` using a configured agent credential and grant, and the
tool result reports TrustRail's actual decision. This is deliberately not a
remote/HTTP MCP deployment; identity comes entirely from the environment
variables below. If you build a remote (HTTP) MCP deployment later, follow
the current official MCP authorization specification and avoid token
passthrough — do not reuse this stdio pattern for that.

## Prerequisites

An agent API key and a grant ID for it to act under (see
`docs/SDK_QUICKSTART.md`'s "Getting a grant ID and API key").

## Build

```bash
pnpm --filter @trustrail/mcp-adapter run build
```

This produces `packages/mcp-adapter/dist/index.js`, a self-contained
executable entrypoint (`node dist/index.js`).

## Configure your MCP client

Environment variables the adapter requires:

| Variable | Required | Meaning |
|---|---|---|
| `TRUSTRAIL_BASE_URL` | yes | e.g. `http://localhost:4000` |
| `TRUSTRAIL_API_KEY` | yes | An agent's secret (`trsk_sandbox_...`) |
| `TRUSTRAIL_GRANT_ID` | yes | The grant this agent will act under |
| `TRUSTRAIL_CONNECTOR_ID` | no (default `merchant_sandbox`) | Which connector to target |

Example Claude Desktop / any MCP-client config entry:

```json
{
  "mcpServers": {
    "trustrail": {
      "command": "node",
      "args": ["/absolute/path/to/trustrail/packages/mcp-adapter/dist/index.js"],
      "env": {
        "TRUSTRAIL_BASE_URL": "http://localhost:4000",
        "TRUSTRAIL_API_KEY": "trsk_sandbox_...",
        "TRUSTRAIL_GRANT_ID": "grant_..."
      }
    }
  }
}
```

## Tools

- **`get_order(order_id)`** — read-only lookup through the gateway (the
  merchant credential never leaves `apps/api`). Returns remaining
  refundable balance, currency, age in days, disputed flag.
- **`request_refund(order_id, amount_minor, currency, reason, idempotency_key)`**
  — submits a real `refund.create` action. The response is TrustRail's
  actual `decision`/`execution_state`/`reason_codes` — an LLM driving this
  tool cannot make itself the authority on whether its own refund is
  allowed; it can only ask and receive a real answer. Reuse the same
  `idempotency_key` to safely retry.
- **`get_action_status(action_id)`** — check on a previously submitted
  action (e.g. one left `awaiting_approval` or `unknown`).

## Verifying your setup

`packages/mcp-adapter/test/mcp.integration.test.ts` is a real MCP client
(the official `@modelcontextprotocol/sdk` `Client`) driving the actual built
adapter binary as a subprocess against a real running TrustRail stack — not
a mock. Run it with:

```bash
pnpm --filter @trustrail/mcp-adapter run build
pnpm --filter @trustrail/mcp-adapter run test
```

If that passes, your MCP client configuration above will work the same way
against your own running `apps/api`.

## The core demo works without an LLM

The gateway is the sole authority regardless of what calls it. An optional
LLM-driven support-agent example may propose tool calls, but it never
decides whether they're allowed — see `examples/support-agent-ts` and
`examples/support-agent-python`, which run their scripted scenarios without
any model API key at all.
