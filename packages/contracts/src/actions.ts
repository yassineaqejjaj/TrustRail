import { z } from "zod";
import { idSchema, PREFIXES } from "./ids.js";
import { amountMinorSchema, currencySchema } from "./money.js";
import { ACTIONS } from "./enums.js";

const grantId = idSchema(PREFIXES.grant);
const connectorId = idSchema(PREFIXES.connector);

/**
 * Payload accepted by POST /v1/actions, authenticated by the subject
 * agent's credential. Deliberately excludes actor_id, principal_id,
 * allowed, role, policy_version, and any destination account per
 * docs/PRODUCT_SPEC.md section 11 — `.strict()` makes zod reject any of
 * those (or any other unknown field) with a 400 instead of silently
 * dropping them.
 */
export const refundArgumentsSchema = z
  .object({
    amount_minor: amountMinorSchema,
    currency: currencySchema,
    reason: z.string().max(500).default(""),
  })
  .strict();

export const createActionRequestSchema = z
  .object({
    grant_id: grantId,
    connector_id: connectorId,
    action: z.enum(ACTIONS),
    resource_id: z.string().min(1).max(200),
    arguments: refundArgumentsSchema,
  })
  .strict();

export type CreateActionRequest = z.infer<typeof createActionRequestSchema>;

/**
 * The exact fields that participate in the canonical request hash used for
 * idempotency and for binding an approval to "this exact action" (spec
 * section 7 and 8). Does NOT include the idempotency key itself, the
 * organization, or the authenticated actor — those are compared alongside
 * the hash, not folded into it, so that "same key + same payload" and
 * "same key + different payload" can be told apart precisely.
 */
export function canonicalActionPayload(req: CreateActionRequest) {
  return {
    grant_id: req.grant_id,
    connector_id: req.connector_id,
    action: req.action,
    resource_id: req.resource_id,
    arguments: {
      amount_minor: req.arguments.amount_minor,
      currency: req.arguments.currency,
      reason: req.arguments.reason,
    },
  };
}
