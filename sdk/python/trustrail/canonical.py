"""RFC 8785-style JSON canonicalization, kept byte-for-byte identical to the
TypeScript implementation in packages/contracts/src/canonical.ts so a hash
or signature computed by one side always matches the other. See
tests/test_cross_language_receipt.py, which verifies a receipt actually
signed by the TypeScript signer.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


def canonical_json(value: Any) -> str:
    return _serialize(value)


def _serialize(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            raise ValueError("canonical_json: NaN/Infinity are not JSON-serializable")
        if isinstance(value, float) and value.is_integer():
            return json.dumps(int(value))
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_serialize(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        parts = [f"{json.dumps(k, ensure_ascii=False)}:{_serialize(value[k])}" for k in keys]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"canonical_json: unsupported value type {type(value)!r}")


def canonical_hash(value: Any) -> str:
    digest = hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"
