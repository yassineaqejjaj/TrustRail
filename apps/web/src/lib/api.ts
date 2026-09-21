import { apiFetch } from "./api-client";
import type {
  ActionDetail,
  ActionListResponse,
  AgentDetail,
  AgentSummary,
  ApprovalListItem,
  CreateCredentialResponse,
  Grant,
  Me,
  MetricsSummary,
  OrgMembershipRow,
  PolicyBundleWithVersions,
  ReceiptGetResponse,
  ReceiptVerificationResult,
  SimulationResult,
} from "./types";
import type {
  ActionName,
  ApprovalStatus,
  CreateActionRequest,
  CreateAgentRequest,
  CreateGrantRequest,
  Decision,
  Environment,
  ExecutionState,
  PolicyBundle,
} from "@trustrail/contracts";

/**
 * Every function here takes an explicit `orgId` (nullable) rather than
 * reading it from a global — callers pull it from `useAuth()` so the
 * dependency is visible at the call site and easy to test.
 */

export const authApi = {
  register: (email: string, password: string) =>
    apiFetch<{ user_id: string; email: string }>("/v1/auth/register", { method: "POST", body: { email, password } }),
  login: (email: string, password: string) =>
    apiFetch<{ user_id: string; email: string }>("/v1/auth/login", { method: "POST", body: { email, password } }),
  logout: () => apiFetch<{ status: string }>("/v1/auth/logout", { method: "POST", body: {} }),
};

export const meApi = {
  get: () => apiFetch<Me>("/v1/me"),
};

export const organizationsApi = {
  create: (name: string) =>
    apiFetch<{ organization_id: string; name: string; role: string }>("/v1/organizations", {
      method: "POST",
      body: { name },
    }),
};

export const membershipsApi = {
  list: (orgId: string) => apiFetch<{ memberships: OrgMembershipRow[] }>("/v1/memberships", { orgId }),
  add: (orgId: string, email: string, role: string) =>
    apiFetch<{ membership_id: string; role: string }>("/v1/memberships", { method: "POST", orgId, body: { email, role } }),
};

export const agentsApi = {
  list: (orgId: string) => apiFetch<{ agents: AgentSummary[] }>("/v1/agents", { orgId }),
  get: (orgId: string, id: string) => apiFetch<AgentDetail>(`/v1/agents/${id}`, { orgId }),
  create: (orgId: string, body: CreateAgentRequest) =>
    apiFetch<{ agent_id: string }>("/v1/agents", { method: "POST", orgId, body }),
  update: (orgId: string, id: string, body: { name?: string; description?: string; status?: "active" | "disabled" }) =>
    apiFetch<{ status: string }>(`/v1/agents/${id}`, { method: "PATCH", orgId, body }),
  createCredential: (orgId: string, agentId: string) =>
    apiFetch<CreateCredentialResponse>(`/v1/agents/${agentId}/credentials`, { method: "POST", orgId, body: {} }),
  revokeCredential: (orgId: string, credentialId: string) =>
    apiFetch<{ status: string }>(`/v1/credentials/${credentialId}/revoke`, { method: "POST", orgId, body: {} }),
};

export const grantsApi = {
  list: (orgId: string) => apiFetch<{ grants: Grant[] }>("/v1/grants", { orgId }),
  create: (orgId: string, body: CreateGrantRequest) =>
    apiFetch<{ grant_id: string }>("/v1/grants", { method: "POST", orgId, body }),
  revoke: (orgId: string, id: string, reason: string) =>
    apiFetch<{ status: string }>(`/v1/grants/${id}/revoke`, { method: "POST", orgId, body: { reason } }),
};

export const policiesApi = {
  list: (orgId: string) => apiFetch<{ policies: PolicyBundleWithVersions[] }>("/v1/policies", { orgId }),
  createDraft: (orgId: string, environment: Environment, bundle: PolicyBundle) =>
    apiFetch<{ policy_bundle_id: string; version_id: string }>("/v1/policies", {
      method: "POST",
      orgId,
      body: { environment, bundle },
    }),
  addVersion: (orgId: string, bundleId: string, bundle: PolicyBundle, changeReason: string) =>
    apiFetch<{ version_id: string }>(`/v1/policies/${bundleId}/versions`, {
      method: "POST",
      orgId,
      body: { bundle, change_reason: changeReason },
    }),
  publish: (orgId: string, bundleId: string, versionId: string, expectedRevision: number, changeReason: string) =>
    apiFetch<{ status: string }>(`/v1/policies/${bundleId}/publish`, {
      method: "POST",
      orgId,
      body: { version_id: versionId, expected_revision: expectedRevision, change_reason: changeReason },
    }),
};

export const actionsApi = {
  list: (
    orgId: string,
    params: { limit?: number; cursor?: string; agent_id?: string; decision?: Decision; execution_state?: ExecutionState; from?: string; to?: string } = {}
  ) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiFetch<ActionListResponse>(`/v1/actions${suffix}`, { orgId });
  },
  get: (orgId: string, id: string) => apiFetch<ActionDetail>(`/v1/actions/${id}`, { orgId }),
  /** Authenticated as the *agent*, not the user session — used by the Demo lab / onboarding "run first action" step. */
  submit: (bearerToken: string, idempotencyKey: string, body: CreateActionRequest) =>
    apiFetch<ActionDetail>("/v1/actions", { method: "POST", bearerToken, idempotencyKey, body }),
};

export const approvalsApi = {
  list: (orgId: string, status?: ApprovalStatus) =>
    apiFetch<{ approvals: ApprovalListItem[] }>(`/v1/approvals${status ? `?status=${status}` : ""}`, { orgId }),
  approve: (orgId: string, id: string, reason: string) =>
    apiFetch<{ status: string; action_id: string; execution_state: ExecutionState; decision: Decision }>(
      `/v1/approvals/${id}/approve`,
      { method: "POST", orgId, body: { reason } }
    ),
  reject: (orgId: string, id: string, reason: string) =>
    apiFetch<{ status: string; action_id: string; execution_state: ExecutionState; decision: Decision }>(
      `/v1/approvals/${id}/reject`,
      { method: "POST", orgId, body: { reason } }
    ),
};

export const receiptsApi = {
  get: (orgId: string, id: string) => apiFetch<ReceiptGetResponse>(`/v1/receipts/${id}`, { orgId }),
  /** Unauthenticated on purpose — see apps/api/src/routes/receipts.ts. No orgId is sent. */
  verify: (jws: string) => apiFetch<ReceiptVerificationResult>("/v1/receipts/verify", { method: "POST", body: { jws } }),
  jwks: () => apiFetch<{ keys: unknown[] }>("/.well-known/jwks.json"),
};

export const simulationsApi = {
  run: (orgId: string, body: CreateActionRequest) =>
    apiFetch<SimulationResult>("/v1/simulations", { method: "POST", orgId, body }),
};

export const metricsApi = {
  summary: (orgId: string) => apiFetch<MetricsSummary>("/v1/metrics/summary", { orgId }),
};

export const healthApi = {
  live: () => apiFetch<{ status: string }>("/health/live"),
  ready: () => apiFetch<{ status: string }>("/health/ready"),
};

export const demoApi = {
  /** Not implemented server-side yet (see docs/BUILD_STATUS.md) — expected to 404 until POST /v1/demo/runs ships. */
  run: (orgId: string, scenario: string) =>
    apiFetch<{ run_id: string }>("/v1/demo/runs", { method: "POST", orgId, body: { scenario } }),
};

export type { ActionName };
