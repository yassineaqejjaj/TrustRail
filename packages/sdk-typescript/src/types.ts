import type { ActionName, Currency, Decision, ExecutionState, ReasonCode } from "@trustrail/contracts";

export interface ExecuteActionInput {
  grantId: string;
  connectorId: string;
  action: ActionName;
  resourceId: string;
  arguments: { amount_minor: number; currency: Currency; reason?: string };
  idempotencyKey: string;
}

export interface ActionApprovalSummary {
  approval_id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: string;
  reviewer_user_id: string | null;
  decided_at: string | null;
}

export interface ActionReceiptSummary {
  receipt_id: string;
  receipt_type: "decision" | "execution";
  created_at: string;
}

export interface TrustRailAction {
  action_id: string;
  action: ActionName;
  resource_id: string;
  actor_agent_id: string;
  grant_id: string;
  decision: Decision;
  execution_state: ExecutionState;
  reason_codes: ReasonCode[];
  amount_minor: number;
  currency: Currency;
  created_at: string;
  updated_at: string;
  environment?: string;
  connector_id?: string;
  connector_reference?: string | null;
  root_grant_id?: string;
  principal_id?: string;
  policy_version_id?: string | null;
  policy_hash?: string | null;
  request_hash?: string;
  trace_id?: string;
  approval?: ActionApprovalSummary | null;
  receipts?: ActionReceiptSummary[];
}

export const TERMINAL_EXECUTION_STATES: ExecutionState[] = ["succeeded", "failed", "denied", "cancelled", "expired"];

export interface DelegateGrantInput {
  environment: "sandbox" | "production";
  principalId: string;
  subjectAgentId: string;
  parentGrantId: string | null;
  allowedActions: ActionName[];
  allowedResourceIds: string[];
  unrestrictedResources?: boolean;
  allowedConnectorIds: string[];
  currency: Currency;
  maxAmountMinor: number;
  rootBudgetLimitMinor?: number | null;
  childBudgetLimitMinor?: number | null;
  validFrom?: string | null;
  expiresAt: string | null;
  delegationAllowed?: boolean;
  maxRemainingDepth: number;
}

export interface ReceiptRecord {
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
