import { z } from "zod";
import { idSchema, PREFIXES } from "./ids.js";
import { amountMinorSchema, currencySchema } from "./money.js";

const grantId = idSchema(PREFIXES.grant);
// See grants.ts: connector IDs are configured slugs, not opaque generated IDs.
const connectorId = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, "connector_id must be a lowercase slug");

const baseActionFields = {
  grant_id: grantId,
  connector_id: connectorId,
  resource_id: z.string().min(1).max(200),
};

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

export const grantCreditArgumentsSchema = z
  .object({
    amount_minor: amountMinorSchema,
    currency: currencySchema,
    reason: z.string().max(500).default(""),
  })
  .strict();

export const changePlanArgumentsSchema = z
  .object({
    target_plan: z.string().min(1).max(50),
    reason: z.string().max(500).default(""),
  })
  .strict();

export const activateFeatureArgumentsSchema = z
  .object({
    feature_key: z.string().min(1).max(50),
    reason: z.string().max(500).default(""),
  })
  .strict();

export const inviteUserArgumentsSchema = z
  .object({
    email: z.string().email(),
    role: z.string().min(1).max(50),
    reason: z.string().max(500).default(""),
  })
  .strict();

export const createRefundActionRequestSchema = z.object({ ...baseActionFields, action: z.literal("refund.create"), arguments: refundArgumentsSchema }).strict();
export const createGrantCreditActionRequestSchema = z
  .object({ ...baseActionFields, action: z.literal("subscription.grant_credit"), arguments: grantCreditArgumentsSchema })
  .strict();
export const createChangePlanActionRequestSchema = z
  .object({ ...baseActionFields, action: z.literal("subscription.change_plan"), arguments: changePlanArgumentsSchema })
  .strict();
export const createActivateFeatureActionRequestSchema = z
  .object({ ...baseActionFields, action: z.literal("subscription.activate_feature"), arguments: activateFeatureArgumentsSchema })
  .strict();
export const createInviteUserActionRequestSchema = z
  .object({ ...baseActionFields, action: z.literal("subscription.invite_user"), arguments: inviteUserArgumentsSchema })
  .strict();

export const createActionRequestSchema = z.discriminatedUnion("action", [
  createRefundActionRequestSchema,
  createGrantCreditActionRequestSchema,
  createChangePlanActionRequestSchema,
  createActivateFeatureActionRequestSchema,
  createInviteUserActionRequestSchema,
]);

export type CreateActionRequest = z.infer<typeof createActionRequestSchema>;

/**
 * The exact fields that participate in the canonical request hash used for
 * idempotency and for binding an approval to "this exact action" (spec
 * section 7 and 8). Does NOT include the idempotency key itself, the
 * organization, or the authenticated actor — those are compared alongside
 * the hash, not folded into it, so that "same key + same payload" and
 * "same key + different payload" can be told apart precisely. Generic
 * across every action: `arguments` is already a closed (`.strict()`)
 * shape with defaults applied by the schema above, so hashing the whole
 * object is exactly as precise as hand-picking fields used to be, without
 * needing a new hardcoded field list per action.
 */
export function canonicalActionPayload(req: CreateActionRequest) {
  return {
    grant_id: req.grant_id,
    connector_id: req.connector_id,
    action: req.action,
    resource_id: req.resource_id,
    arguments: req.arguments,
  };
}
