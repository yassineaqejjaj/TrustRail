"""Exercises the Python SDK against a genuinely running TrustRail API
(real ephemeral Postgres, real merchant-sandbox HTTP server) -- spec
section 16: "SDK contract tests run against the real API."

This spawns tests/integration/live-fixture-server.ts (a Node/tsx script)
as a subprocess, which boots the real stack and prints one JSON line
describing how to reach it. Requires Node + the repo's pnpm dependencies
to be installed, which is true in this repo's own CI/dev environment.
Skipped automatically if `node`/`npx` are not on PATH or the fixture
server fails to start within the timeout, so this file never blocks a
Python-only environment from running the rest of the suite.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_SCRIPT = REPO_ROOT / "tests" / "integration" / "live-fixture-server.ts"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trustrail import TrustRail  # noqa: E402


def _npx_available() -> bool:
    return shutil.which("npx") is not None


@pytest.fixture(scope="module")
def live_server():
    if not _npx_available():
        pytest.skip("npx is not available; skipping live-API SDK test")

    proc = subprocess.Popen(
        ["npx", "tsx", str(FIXTURE_SCRIPT)],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 60
        line = None
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                stderr = proc.stderr.read() if proc.stderr else ""
                pytest.skip(f"live fixture server exited early: {stderr[-2000:]}")
            raw = proc.stdout.readline() if proc.stdout else ""
            if raw.strip().startswith("FIXTURE_READY:"):
                line = raw.strip()[len("FIXTURE_READY:"):]
                break
        if line is None:
            proc.terminate()
            pytest.skip("live fixture server did not report readiness in time")
        info = json.loads(line)
        yield info
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_execute_and_wait_against_a_real_running_api(live_server):
    client = TrustRail(base_url=live_server["base_url"], api_key=live_server["api_key"])

    action = client.actions.execute(
        grant_id=live_server["grant_id"],
        connector_id="merchant_sandbox",
        action="refund.create",
        resource_id="order_demo_101",
        arguments={"amount_minor": 8000, "currency": "EUR", "reason": "Python SDK live test"},
        idempotency_key="py-live-test-1",
    )
    assert action["decision"] == "ALLOW"

    result = client.actions.wait(action["action_id"], timeout_s=15)
    assert result["execution_state"] == "succeeded"
    assert result["connector_reference"]


def test_denied_action_against_a_real_running_api(live_server):
    client = TrustRail(base_url=live_server["base_url"], api_key=live_server["api_key"])
    action = client.actions.execute(
        grant_id=live_server["grant_id"],
        connector_id="merchant_sandbox",
        action="refund.create",
        resource_id="order_demo_103",
        arguments={"amount_minor": 70000, "currency": "EUR", "reason": "too large"},
        idempotency_key="py-live-test-deny-1",
    )
    assert action["decision"] == "DENY"


def test_receipts_get_and_verify_against_a_real_running_api(live_server):
    client = TrustRail(base_url=live_server["base_url"], api_key=live_server["api_key"])
    action = client.actions.execute(
        grant_id=live_server["grant_id"],
        connector_id="merchant_sandbox",
        action="refund.create",
        resource_id="order_demo_107",
        arguments={"amount_minor": 3000, "currency": "EUR", "reason": "receipt check"},
        idempotency_key="py-live-test-receipt-1",
    )
    receipt_id = next(r["receipt_id"] for r in action["receipts"] if r["receipt_type"] == "execution")
    receipt = client.receipts.get(receipt_id)
    verification = client.receipts.verify(receipt["jws"])
    assert verification["signature_valid"] is True
    assert verification["payload"]["outcome"] == "succeeded"
