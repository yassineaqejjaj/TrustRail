"""A minimal support-agent example, Python edition. Mirrors
examples/support-agent-ts exactly -- see its module docstring for why this
runs without any LLM provider and why the gateway remains the sole
authority regardless of what decide_refund_amount() proposes.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdk", "python"))
from trustrail import TrustRail, TrustRailApiError  # noqa: E402

BASE_URL = os.environ.get("TRUSTRAIL_BASE_URL", "http://localhost:4000")
API_KEY = os.environ.get("TRUSTRAIL_API_KEY")
GRANT_ID = os.environ.get("TRUSTRAIL_GRANT_ID")

if not API_KEY or not GRANT_ID:
    print("Set TRUSTRAIL_API_KEY and TRUSTRAIL_GRANT_ID (see docs/SDK_QUICKSTART.md).")
    sys.exit(1)


def decide_refund_amount(customer_message: str):
    # A real integration might call an LLM here. The result is still just
    # a proposal -- TrustRail's gateway is the sole authority on whether
    # the refund actually happens.
    return 8000, f"Support agent proposal for: {customer_message!r}"


def main():
    order_id = os.environ.get("SUPPORT_AGENT_ORDER_ID", "order_demo_101")
    customer_message = "The item arrived damaged, please refund EUR 80."
    amount_minor, reason = decide_refund_amount(customer_message)

    client = TrustRail(base_url=BASE_URL, api_key=API_KEY)
    print(f"Requesting a EUR {amount_minor / 100:.2f} refund on {order_id}...")

    try:
        action = client.actions.execute(
            grant_id=GRANT_ID,
            connector_id="merchant_sandbox",
            action="refund.create",
            resource_id=order_id,
            arguments={"amount_minor": amount_minor, "currency": "EUR", "reason": reason},
            idempotency_key=f"support-agent-{order_id}-{int(time.time())}",
        )

        if action["decision"] == "DENY":
            print(f"Denied: {', '.join(action['reason_codes'])}")
            return
        if action["decision"] == "REQUIRE_APPROVAL":
            print("Requires human approval; waiting up to 60s for a reviewer...")
            result = client.actions.wait(action["action_id"], timeout_s=60)
            print(f"Resolved to: {result['decision']} / {result['execution_state']}")
            return
        result = client.actions.wait(action["action_id"], timeout_s=30)
        print(f"Execution state: {result['execution_state']}, connector reference: {result.get('connector_reference')}")
    except TrustRailApiError as exc:
        print(f"TrustRail rejected the request: {exc.code} -- {exc}")


if __name__ == "__main__":
    main()
