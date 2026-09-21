# TrustRail Python SDK

Python client for the TrustRail API (see `../../docs/PRODUCT_SPEC.md`
section 12 and `../../docs/SDK_QUICKSTART.md`). Mirrors the TypeScript SDK
(`packages/sdk-typescript`) method for method against the same live API.

## Requirements

- Python 3.9 or newer.
- A virtual environment is strongly recommended (this package is not
  published to PyPI; it is installed in editable mode from this directory).

## Setup

```bash
cd sdk/python
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

## Quickstart

```python
from trustrail import TrustRail

client = TrustRail(base_url="http://localhost:4000", api_key="trsk_sandbox_...")

action = client.actions.execute(
    grant_id="grant_...",
    connector_id="merchant_sandbox",
    action="refund.create",
    resource_id="order_demo_101",
    arguments={"amount_minor": 8000, "currency": "EUR", "reason": "Return"},
    idempotency_key="demo-refund-001",
)
# Handle every execution_state explicitly -- there is no single "success" flag.
result = client.actions.wait(action["action_id"], timeout_s=30)
print(result["decision"], result["execution_state"])
```

## Local receipt verification

`trustrail.receipts.verify_receipt_jws` verifies a receipt's Ed25519
signature entirely locally, against explicitly pinned public keys -- it
never trusts a key embedded in the receipt itself, and it never calls the
network. This is the same RFC 8785 canonicalization and signature check
the TrustRail API itself performs; `tests/test_cross_language_receipt.py`
verifies a receipt actually signed by the TypeScript signer
(`@trustrail/receipt-verifier`) to prove the two implementations agree
byte-for-byte.

## Running the tests

```bash
source .venv/bin/activate
pytest
```

Some tests require a live TrustRail API (see `tests/test_sdk_live.py`'s
module docstring) and are skipped automatically if `TRUSTRAIL_TEST_BASE_URL`
is not set.
