/**
 * Response shapes returned by apps/api's route serializers. These are
 * hand-mirrored from apps/api/src/routes/*.ts (the snake_case JSON the
 * server actually emits) rather than re-exported from @trustrail/contracts,
 * because contracts holds request schemas and internal domain types, not
 * the wire response shapes. Enums are re-used from contracts so the two
 * never drift on allowed values.
 */
import type {
  ActionName,
  ApprovalStatus,
  Currency,
  Decision,
  Environment,
  ExecutionState,
  PolicyBundle,
  PolicyVersionStatus,
  ReasonCode,
  Role,
} from "@trustrail/contracts";

export interface Membership {
  organization_id: string;
  organization_name: string;
  role: Role;
}

export interface Me {
  user_id: string;
  email: string;
  memberships: Membership[];
}

export interface OrgMembershipRow {
  membership_id: string;
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface AgentSummary {
  agent_id: string;
  name: string;
  description: string;
  owner_user_id: string;
  environment: Environment;
  status: "active" | "disabled" | "revoked";
  last_activity_at: string | null;
  created_at: string;
}

export interface AgentCredentialInfo {
  credential_id: string;
  prefix: string;
  status: "active" | "rotated" | "revoked" | "expired";
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface AgentDetail extends AgentSummary {
  credentials: AgentCredentialInfo[];
}

export interface CreateCredentialResponse {
  credential_id: string;
  secret: string;
  prefix: string;
  warning: string;
}

export interface Grant {
  grant_id: string;
  environment: Environment;
  principal_id: string;
  issuer_type: "user" | "agent";
  issuer_id: string;
  subject_agent_id: string;
  parent_grant_id: string | null;
  root_grant_id: string;
  allowed_actions: ActionName[];
  allowed_resource_ids: string[];
  unrestricted_resources: boolean;
  allowed_connector_ids: string[];
  currency: Currency;
  max_amount_minor: number;
  root_budget_limit_minor: number | null;
  child_budget_limit_minor: number | null;
  valid_from: string | null;
  expires_at: string | null;
  delegation_allowed: boolean;
  max_remaining_depth: number;
  status: "active" | "revoked" | "expired";
  created_at: string;
  revoked_at: string | null;
}

export interface PolicyVersion {
  version_id: string;
  version_number: number;
  bundle: PolicyBundle;
  bundle_hash: string;
  status: PolicyVersionStatus;
  change_reason: string;
  created_at: string;
  published_at: string | null;
}

export interface PolicyBundleWithVersions {
  policy_bundle_id: string;
  environment: Environment;
  action: ActionName;
  active_version_id: string | null;
  revision: number;
  versions: PolicyVersion[];
}

export interface ActionSummary {
  action_id: string;
  action: ActionName;
  resource_id: string;
  actor_agent_id: string;
  grant_id: string;
  decision: Decision;
  execution_state: ExecutionState;
  reason_codes: ReasonCode[];
  // null for non-money action types (subscription.change_plan/activate_feature/invite_user) -- not "zero cost", just not applicable.
  amount_minor: number | null;
  currency: Currency | null;
  created_at: string;
  updated_at: string;
}

export interface ActionApprovalRef {
  approval_id: string;
  status: ApprovalStatus;
  expires_at: string;
  reviewer_user_id: string | null;
  decided_at: string | null;
}

export interface ActionReceiptRef {
  receipt_id: string;
  receipt_type: "decision" | "execution";
  created_at: string;
}

export interface ActionDetail extends ActionSummary {
  environment: Environment;
  connector_id: string;
  connector_reference: string | null;
  root_grant_id: string;
  principal_id: string;
  policy_version_id: string | null;
  policy_hash: string | null;
  request_hash: string;
  trace_id: string;
  approval: ActionApprovalRef | null;
  receipts: ActionReceiptRef[];
}

export interface ActionListResponse {
  actions: ActionSummary[];
  next_cursor: string | null;
}

export interface ApprovalListItem {
  approval_id: string;
  action_id: string;
  principal_id: string;
  grant_chain_ids: string[];
  // null for a non-money action's approval -- not "zero cost".
  amount_minor: number | null;
  currency: Currency | null;
  triggering_rule: string;
  status: ApprovalStatus;
  expires_at: string;
  created_at: string;
  reviewer_user_id: string | null;
  decided_at: string | null;
  action: {
    resource_id: string;
    action: ActionName;
    actor_agent_id: string;
    root_grant_id: string;
  } | null;
}

export interface AgentActivityAnomaly {
  agent_id: string;
  agent_name: string;
  window_seconds: number;
  request_count: number;
  threshold: number;
}

export interface ReconciliationItem {
  action_id: string;
  resource_id: string;
  action: ActionName;
  amount_minor: number;
  currency: Currency;
  actor_agent_id: string;
  attempt_count: number;
  last_error: string | null;
  job_status: string;
  needs_manual_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReceiptGetResponse {
  receipt_id: string;
  receipt_type: "decision" | "execution";
  jws: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ReceiptVerificationResult {
  signature_valid: boolean;
  issuer_trusted: boolean;
  key_id: string | null;
  key_status: "active" | "rotated" | "unknown" | "revoked";
  payload: Record<string, unknown> | null;
  errors: string[];
}

export interface MetricsSummary {
  total_actions: number;
  allowed: number;
  denied: number;
  awaiting_approval: number;
  succeeded: number;
  failed: number;
  unknown: number;
  execution_success_rate: number | null;
  authorization_latency_ms: { p50: number | null; p95: number | null; p99: number | null };
  note: string;
}

export interface SimulationResult {
  prediction: true;
  note: string;
  decision: Decision;
  reason_codes: ReasonCode[];
  explanation: string;
  matched_checks: string[];
  evaluated_values: Record<string, unknown>;
}
