import { z } from "zod";

/**
 * A human manually resolving an action stuck in `unknown` execution state
 * (e.g. after confirming the real outcome directly with the merchant).
 * Mirrors the legal `unknown -> succeeded | failed` transition in
 * EXECUTION_STATE_TRANSITIONS (packages/contracts/src/enums.ts).
 */
export const resolveReconciliationRequestSchema = z
  .object({
    outcome: z.enum(["succeeded", "failed"]),
    note: z.string().min(1).max(1000),
    connector_reference: z.string().max(200).optional(),
  })
  .strict();

export type ResolveReconciliationRequest = z.infer<typeof resolveReconciliationRequestSchema>;
