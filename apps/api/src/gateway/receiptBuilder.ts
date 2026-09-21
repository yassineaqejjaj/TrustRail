import type { Db } from "../db/client.js";
import { receipts } from "../db/schema.js";
import { newId } from "../db/ids.js";
import { signReceipt } from "@trustrail/receipt-verifier";
import type { ActiveSigningKey } from "./keys.js";
import type { ReceiptPayload, ReceiptType, Decision, ExecutionState, ReasonCode, ActionName } from "@trustrail/contracts";

export interface ReceiptInputs {
  receiptType: ReceiptType;
  organizationId: string;
  environment: string;
  actionId: string;
  actorId: string;
  principalId: string;
  delegationChainIds: string[];
  action: ActionName;
  resourceId: string;
  requestHash: string;
  policyVersionId: string;
  policyHash: string;
  decision: Decision;
  reasonCodes: ReasonCode[];
  approvalId: string | null;
  outcome: ExecutionState | null;
  connectorReference: string | null;
  issuer: string;
}

export async function issueReceipt(db: Db, signingKey: ActiveSigningKey, input: ReceiptInputs): Promise<{ receiptId: string; jws: string }> {
  const receiptId = newId("receipt");
  const payload: ReceiptPayload = {
    schema_version: "1",
    receipt_type: input.receiptType,
    receipt_id: receiptId,
    issuer: input.issuer,
    organization_id: input.organizationId,
    environment: input.environment as "sandbox" | "production",
    action_id: input.actionId,
    actor_id: input.actorId,
    principal_id: input.principalId,
    delegation_chain_ids: input.delegationChainIds,
    action: input.action,
    resource_id: input.resourceId,
    request_hash: input.requestHash,
    policy_version_id: input.policyVersionId,
    policy_hash: input.policyHash,
    decision: input.decision,
    reason_codes: input.reasonCodes,
    approval_id: input.approvalId,
    outcome: input.outcome,
    connector_reference: input.connectorReference,
    recorded_at: new Date().toISOString(),
  };

  const jws = await signReceipt(payload, signingKey.privateJwk, signingKey.kid);

  await db.insert(receipts).values({
    id: receiptId,
    organizationId: input.organizationId,
    actionId: input.actionId,
    receiptType: input.receiptType,
    payload,
    jws,
    keyId: signingKey.kid,
  });

  return { receiptId, jws };
}
