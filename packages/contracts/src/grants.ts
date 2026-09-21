import { z } from "zod";
import { idSchema, PREFIXES } from "./ids.js";
import { amountMinorSchema, currencySchema } from "./money.js";
import { ACTIONS, ENVIRONMENTS } from "./enums.js";

const orgId = idSchema(PREFIXES.organization);
const agentId = idSchema(PREFIXES.agent);
const userId = idSchema(PREFIXES.user);
const grantId = idSchema(PREFIXES.grant);
const connectorId = idSchema(PREFIXES.connector);

/**
 * Payload accepted by POST /v1/grants. The caller never supplies
 * `issuer_id` (derived from the authenticated session/credential) or
 * `organization_id` (derived from tenant context) — see
 * docs/PRODUCT_SPEC.md section 11: "Resolve identity and policy
 * server-side."
 */
export const createGrantRequestSchema = z
  .object({
    environment: z.enum(ENVIRONMENTS),
    principal_id: userId,
    subject_agent_id: agentId,
    parent_grant_id: grantId.nullable().default(null),
    allowed_actions: z.array(z.enum(ACTIONS)).min(1),
    allowed_resource_ids: z.array(z.string().min(1)).max(1000),
    unrestricted_resources: z.boolean().default(false),
    allowed_connector_ids: z.array(connectorId).min(1),
    currency: currencySchema,
    max_amount_minor: amountMinorSchema,
    root_budget_limit_minor: amountMinorSchema.nullable(),
    child_budget_limit_minor: amountMinorSchema.nullable(),
    valid_from: z.string().datetime().nullable().default(null),
    expires_at: z.string().datetime().nullable(),
    delegation_allowed: z.boolean().default(false),
    max_remaining_depth: z.number().int().min(0).max(3),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!body.unrestricted_resources && body.allowed_resource_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "allowed_resource_ids must be non-empty unless unrestricted_resources is explicitly set (empty means no resources, never all resources)",
        path: ["allowed_resource_ids"],
      });
    }
  });

export type CreateGrantRequest = z.infer<typeof createGrantRequestSchema>;

export const revokeGrantRequestSchema = z
  .object({
    reason: z.string().min(1).max(500),
  })
  .strict();

export const GRANT_MAX_CHAIN_DEPTH = 3;
