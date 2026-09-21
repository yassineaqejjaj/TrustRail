"""TrustRail Python client. Mirrors packages/sdk-typescript method for
method against the same live API (docs/PRODUCT_SPEC.md section 12).
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import httpx

from .errors import TrustRailApiError, TrustRailNetworkError, TrustRailTimeoutError
from .receipts import ReceiptVerificationResult, TrustedKey, verify_receipt_jws

TERMINAL_EXECUTION_STATES = {"succeeded", "failed", "denied", "cancelled", "expired"}


class _HttpClient:
    def __init__(self, base_url: str, api_key: Optional[str], timeout_s: float = 10.0, transport: Optional[httpx.BaseTransport] = None):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._client = httpx.Client(transport=transport)

    def request(self, method: str, path: str, *, json_body: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None, timeout_s: Optional[float] = None, retries: int = 0) -> Any:
        url = f"{self._base_url}{path}"
        req_headers = {"content-type": "application/json"}
        if self._api_key:
            req_headers["authorization"] = f"Bearer {self._api_key}"
        if headers:
            req_headers.update(headers)

        attempts = 1 + retries
        last_exc: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            try:
                response = self._client.request(method, url, json=json_body, headers=req_headers, timeout=timeout_s or self._timeout_s)
            except httpx.TimeoutException as exc:
                last_exc = TrustRailTimeoutError(f"request to {path} timed out")
                if attempt < attempts:
                    time.sleep(min(0.25 * 2 ** (attempt - 1), 2.0))
                    continue
                raise last_exc from exc
            except httpx.HTTPError as exc:
                last_exc = TrustRailNetworkError(f"request to {path} failed: {exc}")
                if attempt < attempts:
                    time.sleep(min(0.25 * 2 ** (attempt - 1), 2.0))
                    continue
                raise last_exc from exc

            if response.status_code >= 400:
                body = response.json() if response.content else {}
                raise TrustRailApiError(
                    response.status_code,
                    body.get("code", "UNKNOWN"),
                    body.get("message", response.text),
                    body.get("request_id", ""),
                    body.get("details"),
                )
            return response.json() if response.content else None
        raise last_exc  # pragma: no cover -- unreachable, satisfies type checkers


class ActionsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def execute(
        self,
        *,
        grant_id: str,
        connector_id: str,
        action: str,
        resource_id: str,
        arguments: Dict[str, Any],
        idempotency_key: str,
    ) -> Dict[str, Any]:
        """Executes a protected action. Retries once on a network error/timeout,
        always with the SAME idempotency_key -- never generate a new one after
        an ambiguous timeout (docs/PRODUCT_SPEC.md section 12)."""
        return self._http.request(
            "POST",
            "/v1/actions",
            json_body={"grant_id": grant_id, "connector_id": connector_id, "action": action, "resource_id": resource_id, "arguments": arguments},
            headers={"idempotency-key": idempotency_key},
            timeout_s=15.0,
            retries=1,
        )

    def get(self, action_id: str) -> Dict[str, Any]:
        return self._http.request("GET", f"/v1/actions/{action_id}")

    def wait(self, action_id: str, *, timeout_s: float = 30.0, poll_interval_s: float = 1.0) -> Dict[str, Any]:
        """Polls until execution_state is terminal. Callers must handle every
        terminal state explicitly -- ALLOW+succeeded, DENY, and
        REQUIRE_APPROVAL-then-rejected are all valid, different outcomes."""
        deadline = time.monotonic() + timeout_s
        while True:
            action = self.get(action_id)
            if action.get("execution_state") in TERMINAL_EXECUTION_STATES:
                return action
            if time.monotonic() >= deadline:
                raise TrustRailTimeoutError(f"action {action_id} did not reach a terminal state within {timeout_s}s (last state: {action.get('execution_state')})")
            time.sleep(poll_interval_s)


class GrantsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def delegate(
        self,
        *,
        environment: str,
        principal_id: str,
        subject_agent_id: str,
        parent_grant_id: Optional[str],
        allowed_actions: List[str],
        allowed_resource_ids: List[str],
        allowed_connector_ids: List[str],
        currency: str,
        max_amount_minor: int,
        expires_at: Optional[str],
        max_remaining_depth: int,
        unrestricted_resources: bool = False,
        root_budget_limit_minor: Optional[int] = None,
        child_budget_limit_minor: Optional[int] = None,
        valid_from: Optional[str] = None,
        delegation_allowed: bool = False,
    ) -> Dict[str, Any]:
        """Not idempotent -- there is no idempotency key on this endpoint, so
        this is never automatically retried on a network error."""
        return self._http.request(
            "POST",
            "/v1/grants",
            json_body={
                "environment": environment,
                "principal_id": principal_id,
                "subject_agent_id": subject_agent_id,
                "parent_grant_id": parent_grant_id,
                "allowed_actions": allowed_actions,
                "allowed_resource_ids": allowed_resource_ids,
                "unrestricted_resources": unrestricted_resources,
                "allowed_connector_ids": allowed_connector_ids,
                "currency": currency,
                "max_amount_minor": max_amount_minor,
                "root_budget_limit_minor": root_budget_limit_minor,
                "child_budget_limit_minor": child_budget_limit_minor,
                "valid_from": valid_from,
                "expires_at": expires_at,
                "delegation_allowed": delegation_allowed,
                "max_remaining_depth": max_remaining_depth,
            },
        )


class ReceiptsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def get(self, receipt_id: str) -> Dict[str, Any]:
        return self._http.request("GET", f"/v1/receipts/{receipt_id}")

    def verify(self, jws: str) -> Dict[str, Any]:
        """Server-side verification (unauthenticated endpoint). For fully
        offline/local verification against pinned keys, use
        trustrail.receipts.verify_receipt_jws instead."""
        return self._http.request("POST", "/v1/receipts/verify", json_body={"jws": jws})

    @staticmethod
    def verify_local(jws: str, trusted_keys: List[TrustedKey]) -> ReceiptVerificationResult:
        return verify_receipt_jws(jws, trusted_keys)


class ConnectorsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def get_resource(self, connector_id: str, resource_id: str) -> Dict[str, Any]:
        return self._http.request("GET", f"/v1/connectors/{connector_id}/resources/{resource_id}")


class TrustRail:
    def __init__(self, *, base_url: str, api_key: str, timeout_s: float = 10.0, transport: Optional[httpx.BaseTransport] = None):
        http = _HttpClient(base_url, api_key, timeout_s, transport=transport)
        self.actions = ActionsResource(http)
        self.grants = GrantsResource(http)
        self.receipts = ReceiptsResource(http)
        self.connectors = ConnectorsResource(http)
