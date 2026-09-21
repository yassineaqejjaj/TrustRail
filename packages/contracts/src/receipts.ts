import { z } from "zod";
import { idSchema, PREFIXES } from "./ids.js";
import { ACTIONS, DECISIONS, ENVIRONMENTS, EXECUTION_STATES, REASON_CODES, RECEIPT_TYPES } from "./enums.js";

/**
 * Exact shape from docs/PRODUCT_SPEC.md section 9. This is the payload that
 * gets RFC 8785 canonicalized and signed (JWS, Ed25519) — never mutate a
 * field name here without bumping schema_version, or historical receipts
 * will fail to re-verify.
 */
export const receiptPayloadSchema = z
  .object({
    schema_version: z.literal("1"),
    receipt_type: z.enum(RECEIPT_TYPES),
    receipt_id: idSchema(PREFIXES.receipt),
    issuer: z.string().min(1),
    organization_id: idSchema(PREFIXES.organization),
    environment: z.enum(ENVIRONMENTS),
    action_id: idSchema(PREFIXES.action),
    actor_id: idSchema(PREFIXES.agent),
    principal_id: idSchema(PREFIXES.user),
    delegation_chain_ids: z.array(idSchema(PREFIXES.grant)).min(1),
    action: z.enum(ACTIONS),
    resource_id: z.string().min(1),
    request_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    policy_version_id: idSchema(PREFIXES.policyVersion),
    policy_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    decision: z.enum(DECISIONS),
    reason_codes: z.array(z.enum(REASON_CODES)),
    approval_id: idSchema(PREFIXES.approval).nullable(),
    outcome: z.enum(EXECUTION_STATES).nullable(),
    connector_reference: z.string().nullable(),
    recorded_at: z.string().datetime(),
  })
  .strict();

export type ReceiptPayload = z.infer<typeof receiptPayloadSchema>;

export const RECEIPT_JWS_TYP = "application/trustrail-receipt+jws";
export const RECEIPT_JWS_ALG = "EdDSA" as const;

export const verifyReceiptRequestSchema = z
  .object({
    jws: z.string().min(1),
  })
  .strict();

export const receiptVerificationResultSchema = z.object({
  signature_valid: z.boolean(),
  issuer_trusted: z.boolean(),
  key_id: z.string().nullable(),
  key_status: z.enum(["active", "rotated", "unknown", "revoked"]),
  payload: receiptPayloadSchema.nullable(),
  errors: z.array(z.string()),
});

export type ReceiptVerificationResult = z.infer<typeof receiptVerificationResultSchema>;
