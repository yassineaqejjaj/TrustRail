"""Local, offline verification of TrustRail receipt JWS tokens.

Mirrors packages/receipt-verifier's verify.ts: explicit Ed25519 algorithm
allowlist, explicit `typ` check, and trust decided only by an
externally-supplied set of pinned keys -- never by anything embedded in the
JWS itself (docs/PRODUCT_SPEC.md section 9: "Never trust a public key
embedded by the same untrusted receipt as sufficient evidence").
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

RECEIPT_JWS_TYP = "application/trustrail-receipt+jws"
RECEIPT_JWS_ALG = "EdDSA"


@dataclass
class TrustedKey:
    kid: str
    public_jwk: Dict[str, Any]
    status: str  # "active" | "rotated" | "revoked"


@dataclass
class ReceiptVerificationResult:
    signature_valid: bool
    issuer_trusted: bool
    key_id: Optional[str]
    key_status: str
    payload: Optional[Dict[str, Any]]
    errors: List[str] = field(default_factory=list)


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def verify_receipt_jws(jws: str, trusted_keys: List[TrustedKey]) -> ReceiptVerificationResult:
    parts = jws.split(".")
    if len(parts) != 3:
        return ReceiptVerificationResult(False, False, None, "unknown", None, ["malformed JWS: expected 3 dot-separated parts"])
    header_b64, payload_b64, signature_b64 = parts

    errors: List[str] = []
    try:
        header = json.loads(_b64url_decode(header_b64))
    except Exception:
        return ReceiptVerificationResult(False, False, None, "unknown", None, ["malformed JWS: could not parse protected header"])

    kid = header.get("kid")
    if header.get("typ") != RECEIPT_JWS_TYP:
        errors.append(f"unexpected typ header: {header.get('typ')!r}")
    if header.get("alg") != RECEIPT_JWS_ALG:
        errors.append(f"unexpected alg header: {header.get('alg')!r}")

    trusted = next((k for k in trusted_keys if k.kid == kid), None)
    if not trusted:
        errors.append(f"unknown issuer key: {kid}" if kid else "no kid present in protected header")
        return ReceiptVerificationResult(False, False, kid, "unknown", None, errors)

    try:
        public_key = Ed25519PublicKey.from_public_bytes(_b64url_decode(trusted.public_jwk["x"]))
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        public_key.verify(_b64url_decode(signature_b64), signing_input)
    except InvalidSignature:
        errors.append("signature verification failed: payload does not match signature (tampering detected)")
        return ReceiptVerificationResult(False, True, kid, trusted.status, None, errors)
    except Exception as exc:  # malformed key material, wrong algorithm, etc.
        errors.append(f"signature verification failed: {exc}")
        return ReceiptVerificationResult(False, True, kid, trusted.status, None, errors)

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        errors.append("payload is not valid JSON")
        return ReceiptVerificationResult(True, True, kid, trusted.status, None, errors)

    return ReceiptVerificationResult(True, True, kid, trusted.status, payload, errors)
