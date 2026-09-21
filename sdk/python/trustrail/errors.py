from __future__ import annotations

from typing import Any, Dict, Optional


class TrustRailApiError(Exception):
    """A definitive error response from the TrustRail API (never retried)."""

    def __init__(self, status_code: int, code: str, message: str, request_id: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.request_id = request_id
        self.details = details


class TrustRailNetworkError(Exception):
    """The request could not be completed at all (connection failure)."""


class TrustRailTimeoutError(Exception):
    """The request (or a poll loop) exceeded its allotted time."""
