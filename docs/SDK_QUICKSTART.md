# SDK quickstart

Both SDKs expose the same surface against the same API: `actions.execute`,
`actions.get`, `actions.wait`, `grants.delegate`, `receipts.get`,
`receipts.verify`. Everything else (agents, credentials, policies,
approvals, memberships) is REST-only — call `docs/API.md`'s routes
directly; those are administrative operations, not something an agent
integration does on every request.

## Getting a grant ID and API key

Both examples below assume you already have an agent's API key and a grant
ID for it to act under. The fastest way to get both locally:

```bash
pnpm setup:local && pnpm dev
pnpm demo:seed   # prints agent secrets and grant IDs for the Northstar Commerce demo org
```

Or, via the dashboard: Onboarding -> create organization -> register agent ->
reveal API key -> issue grant.

## TypeScript (`@trustrail/sdk`, `packages/sdk-typescript`)

```bash
pnpm add @trustrail/sdk   # inside this monorepo: it's a workspace package
```

```ts
import { TrustRail } from "@trustrail/sdk";

const client = new TrustRail({ baseUrl: "http://localhost:4000", apiKey: process.env.TRUSTRAIL_API_KEY! });

const action = await client.actions.execute({
  grantId: process.env.TRUSTRAIL_GRANT_ID!,
  connectorId: "merchant_sandbox",
  action: "refund.create",
  resourceId: "order_demo_101",
  arguments: { amount_minor: 8000, currency: "EUR", reason: "Return" },
  idempotencyKey: "demo-refund-001",
});

// Handle every outcome explicitly -- there is no single "success" flag.
switch (action.decision) {
  case "DENY":
    console.log("denied:", action.reason_codes);
    break;
  case "REQUIRE_APPROVAL": {
    const result = await client.actions.wait(action.action_id, { timeoutMs: 60_000 });
    console.log("resolved to:", result.decision, result.execution_state);
    break;
  }
  case "ALLOW": {
    const result = await client.actions.wait(action.action_id, { timeoutMs: 30_000 });
    if (result.execution_state === "succeeded") console.log("refunded:", result.connector_reference);
    else if (result.execution_state === "unknown") console.log("ambiguous -- check back or rely on the receipt once reconciled");
    else console.log("failed:", result.execution_state);
  }
}
```

`actions.execute` retries once on a network error or timeout, always with
your original `idempotencyKey` — never a fresh one, since a new key would
defeat the server's own duplicate-refund protection. A definitive API error
(4xx/5xx response) is never retried automatically.

Full runnable example: `examples/support-agent-ts`.

## Python (`trustrail`, `sdk/python`)

```bash
cd sdk/python
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

```python
from trustrail import TrustRail

client = TrustRail(base_url="http://localhost:4000", api_key=os.environ["TRUSTRAIL_API_KEY"])

action = client.actions.execute(
    grant_id=os.environ["TRUSTRAIL_GRANT_ID"],
    connector_id="merchant_sandbox",
    action="refund.create",
    resource_id="order_demo_101",
    arguments={"amount_minor": 8000, "currency": "EUR", "reason": "Return"},
    idempotency_key="demo-refund-001",
)

if action["decision"] == "DENY":
    print("denied:", action["reason_codes"])
else:
    result = client.actions.wait(action["action_id"], timeout_s=30)
    print(result["decision"], result["execution_state"])
```

Full runnable example: `examples/support-agent-python`.

## Verifying a receipt locally (no network call)

```python
from trustrail.receipts import TrustedKey, verify_receipt_jws

# Fetch your organization's public keys once, e.g. from GET /.well-known/jwks.json,
# and pin them -- never derive trust from anything inside the receipt itself.
trusted = [TrustedKey(kid="...", public_jwk={...}, status="active")]
result = verify_receipt_jws(receipt_jws, trusted)
print(result.signature_valid, result.issuer_trusted, result.key_status)
```

The TypeScript equivalent is `packages/receipt-verifier`'s `verifyReceiptJws`
(used internally by the API's own `POST /v1/receipts/verify`, and directly
usable by any TypeScript consumer that wants fully offline verification).

Both implementations verify the exact same signed fixture in
`tests/integration/fixtures/cross-language-receipt.json` — see
`sdk/python/tests/test_cross_language_receipt.py`.
