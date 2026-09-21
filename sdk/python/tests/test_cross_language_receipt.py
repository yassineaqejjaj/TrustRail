"""Verifies a receipt that was actually signed by the TypeScript
implementation (@trustrail/receipt-verifier) -- spec section 16: "SDK
contract tests run against the real API; Python and TypeScript verify a
common signed fixture." Also confirms tampering is still detected on a
cross-language fixture, not just on Python-generated ones.
"""

import json
from pathlib import Path

from trustrail.receipts import TrustedKey, verify_receipt_jws

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "tests" / "integration" / "fixtures" / "cross-language-receipt.json"


def load_fixture():
    with open(FIXTURE_PATH) as f:
        return json.load(f)


def test_python_verifies_a_typescript_signed_receipt():
    fixture = load_fixture()
    trusted = [TrustedKey(kid=fixture["kid"], public_jwk=fixture["public_jwk"], status="active")]

    result = verify_receipt_jws(fixture["jws"], trusted)

    assert result.signature_valid is True
    assert result.issuer_trusted is True
    assert result.payload is not None
    assert result.payload["receipt_id"] == fixture["payload"]["receipt_id"]
    assert result.payload["action_id"] == fixture["payload"]["action_id"]
    assert result.errors == []


def test_python_rejects_a_tampered_typescript_signed_receipt():
    fixture = load_fixture()
    trusted = [TrustedKey(kid=fixture["kid"], public_jwk=fixture["public_jwk"], status="active")]

    header_b64, payload_b64, signature_b64 = fixture["jws"].split(".")
    import base64

    def b64url_decode(s):
        return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

    def b64url_encode(b):
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

    payload = json.loads(b64url_decode(payload_b64))
    payload["connector_reference"] = "refund_tampered_by_python_test"
    tampered_payload_b64 = b64url_encode(json.dumps(payload).encode("utf-8"))
    tampered_jws = f"{header_b64}.{tampered_payload_b64}.{signature_b64}"

    result = verify_receipt_jws(tampered_jws, trusted)
    assert result.signature_valid is False


def test_python_rejects_an_unknown_issuer_for_the_same_fixture():
    fixture = load_fixture()
    result = verify_receipt_jws(fixture["jws"], trusted_keys=[])
    assert result.signature_valid is False
    assert result.issuer_trusted is False
