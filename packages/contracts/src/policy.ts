import { z } from "zod";
import { amountMinorSchema, currencySchema } from "./money.js";

/**
 * Fields every policy variant shares, regardless of action:
 * - `root_daily_limit_minor` is a generic daily quota counter, not always
 *   money -- for a money action (refund.create, subscription.grant_credit)
 *   it's minor currency units; for a count-based action (change_plan,
 *   activate_feature, invite_user) it's a plain count of actions per day.
 *   Reusing the same field/mechanism (packages/gateway-core/src/budget.ts's
 *   reservation system already operates on plain integers) rather than
 *   inventing a parallel "quota" system for non-money actions.
 * - `approval_ttl_seconds` applies identically everywhere REQUIRE_APPROVAL
 *   can be reached.
 */
const commonPolicyFields = {
  schema_version: z.literal("1"),
  currency: currencySchema,
  root_daily_limit_minor: amountMinorSchema,
  approval_ttl_seconds: z.number().int().positive().max(86_400),
};

/**
 * The exact shape from docs/PRODUCT_SPEC.md section 6, for `refund.create`.
 * Plain `ZodObject` (no `.superRefine` here) so it can be a member of the
 * `discriminatedUnion` below -- zod requires every union member to be an
 * object schema, not a refined `ZodEffects`. The automatic<=approval
 * cross-field check is applied once, on the union itself, further down.
 */
export const refundPolicyBundleSchema = z
  .object({
    ...commonPolicyFields,
    action: z.literal("refund.create"),
    automatic_limit_minor: amountMinorSchema,
    approval_limit_minor: amountMinorSchema,
    require_original_payment_destination: z.boolean(),
    require_order_ownership: z.boolean(),
    max_order_age_days: z.number().int().positive().max(3650),
    deny_if_payment_disputed: z.boolean(),
  })
  .strict();

export type RefundPolicyBundle = z.infer<typeof refundPolicyBundleSchema>;

/**
 * `subscription.grant_credit` -- the one subscription action with a real
 * amount, so it reuses the same automatic/approval tiering as refunds
 * instead of a bespoke mechanism. No order-specific fields (ownership,
 * age, disputed) since its resource is a SaaS account, not a payment.
 */
export const grantCreditPolicyBundleSchema = z
  .object({
    ...commonPolicyFields,
    action: z.literal("subscription.grant_credit"),
    automatic_limit_minor: amountMinorSchema,
    approval_limit_minor: amountMinorSchema,
  })
  .strict();

export type GrantCreditPolicyBundle = z.infer<typeof grantCreditPolicyBundleSchema>;

/**
 * `subscription.change_plan` -- no amount. `eligible_target_plans` is a
 * hard allow-list (anything else is denied outright, not held for
 * approval); `require_approval_for_downgrade` escalates an otherwise-
 * eligible downgrade to human review, matching "validation des engagements
 * exceptionnels" from the product brief.
 */
export const changePlanPolicyBundleSchema = z
  .object({
    ...commonPolicyFields,
    action: z.literal("subscription.change_plan"),
    eligible_target_plans: z.array(z.string().min(1).max(50)).min(1),
    require_approval_for_downgrade: z.boolean(),
  })
  .strict();

export type ChangePlanPolicyBundle = z.infer<typeof changePlanPolicyBundleSchema>;

/**
 * `subscription.activate_feature` -- a pure allow-list, no approval tier
 * at all. Not every action needs a three-tier automatic/approval/deny
 * system; this one is a deliberate example of a simpler allow/deny gate.
 */
export const activateFeaturePolicyBundleSchema = z
  .object({
    ...commonPolicyFields,
    action: z.literal("subscription.activate_feature"),
    allowed_feature_keys: z.array(z.string().min(1).max(50)).min(1),
  })
  .strict();

export type ActivateFeaturePolicyBundle = z.infer<typeof activateFeaturePolicyBundleSchema>;

/**
 * `subscription.invite_user` -- models the product brief's own example
 * exactly ("no admin rights... request validation for any exception"):
 * `disallow_admin_role` is a hard block, not an approval tier; a role
 * outside `allowed_roles` (but not the disallowed one) is the "exception"
 * that goes to a human instead of being denied outright.
 */
export const inviteUserPolicyBundleSchema = z
  .object({
    ...commonPolicyFields,
    action: z.literal("subscription.invite_user"),
    allowed_roles: z.array(z.string().min(1).max(50)).min(1),
    disallow_admin_role: z.boolean(),
  })
  .strict();

export type InviteUserPolicyBundle = z.infer<typeof inviteUserPolicyBundleSchema>;

export const policyBundleSchema = z
  .discriminatedUnion("action", [
    refundPolicyBundleSchema,
    grantCreditPolicyBundleSchema,
    changePlanPolicyBundleSchema,
    activateFeaturePolicyBundleSchema,
    inviteUserPolicyBundleSchema,
  ])
  .superRefine((bundle, ctx) => {
    if (bundle.action === "refund.create" || bundle.action === "subscription.grant_credit") {
      if (bundle.automatic_limit_minor > bundle.approval_limit_minor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "automatic_limit_minor must be <= approval_limit_minor",
          path: ["automatic_limit_minor"],
        });
      }
    }
  });

export type PolicyBundle = z.infer<typeof policyBundleSchema>;

export const DEFAULT_POLICY_BUNDLE: RefundPolicyBundle = {
  schema_version: "1",
  action: "refund.create",
  currency: "EUR",
  automatic_limit_minor: 10_000,
  approval_limit_minor: 50_000,
  root_daily_limit_minor: 100_000,
  require_original_payment_destination: true,
  require_order_ownership: true,
  max_order_age_days: 30,
  deny_if_payment_disputed: true,
  approval_ttl_seconds: 900,
};

/**
 * Default policies for the four subscription actions, used to seed the
 * demo org's "IT onboarding" surface -- modeled directly on the product
 * brief's own example ("cree ses acces... sans droits administrateur, et
 * achete au maximum 150 EUR de licences. Demande une validation pour
 * toute exception.").
 */
export const DEFAULT_GRANT_CREDIT_POLICY_BUNDLE: GrantCreditPolicyBundle = {
  schema_version: "1",
  action: "subscription.grant_credit",
  currency: "EUR",
  automatic_limit_minor: 15_000, // EUR 150, matching the product brief's onboarding example
  approval_limit_minor: 50_000,
  root_daily_limit_minor: 100_000,
  approval_ttl_seconds: 900,
};

export const DEFAULT_CHANGE_PLAN_POLICY_BUNDLE: ChangePlanPolicyBundle = {
  schema_version: "1",
  action: "subscription.change_plan",
  currency: "EUR",
  root_daily_limit_minor: 20, // 20 plan changes/day, org-wide abuse guard
  approval_ttl_seconds: 900,
  eligible_target_plans: ["starter", "growth", "scale"],
  require_approval_for_downgrade: true,
};

export const DEFAULT_ACTIVATE_FEATURE_POLICY_BUNDLE: ActivateFeaturePolicyBundle = {
  schema_version: "1",
  action: "subscription.activate_feature",
  currency: "EUR",
  root_daily_limit_minor: 50,
  approval_ttl_seconds: 900,
  allowed_feature_keys: ["sso", "advanced_reporting", "api_access", "custom_roles"],
};

export const DEFAULT_INVITE_USER_POLICY_BUNDLE: InviteUserPolicyBundle = {
  schema_version: "1",
  action: "subscription.invite_user",
  currency: "EUR",
  root_daily_limit_minor: 30, // 30 invites/day, org-wide abuse guard
  approval_ttl_seconds: 900,
  allowed_roles: ["member", "billing", "viewer"],
  disallow_admin_role: true,
};
