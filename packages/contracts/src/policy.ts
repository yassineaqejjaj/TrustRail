import { z } from "zod";
import { amountMinorSchema, currencySchema } from "./money.js";
import { ACTIONS } from "./enums.js";

/**
 * A policy bundle is typed data (never executable code). This is the exact
 * shape from docs/PRODUCT_SPEC.md section 6. `automatic_limit_minor` must be
 * strictly less than `approval_limit_minor`, which must be strictly less
 * than `root_daily_limit_minor` is NOT required (daily limit is independent
 * of per-action tiers) but automatic <= approval is required.
 */
export const policyBundleSchema = z
  .object({
    schema_version: z.literal("1"),
    action: z.enum(ACTIONS),
    currency: currencySchema,
    automatic_limit_minor: amountMinorSchema,
    approval_limit_minor: amountMinorSchema,
    root_daily_limit_minor: amountMinorSchema,
    require_original_payment_destination: z.boolean(),
    require_order_ownership: z.boolean(),
    max_order_age_days: z.number().int().positive().max(3650),
    deny_if_payment_disputed: z.boolean(),
    approval_ttl_seconds: z.number().int().positive().max(86_400),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    if (bundle.automatic_limit_minor > bundle.approval_limit_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "automatic_limit_minor must be <= approval_limit_minor",
        path: ["automatic_limit_minor"],
      });
    }
  });

export type PolicyBundle = z.infer<typeof policyBundleSchema>;

export const DEFAULT_POLICY_BUNDLE: PolicyBundle = {
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
