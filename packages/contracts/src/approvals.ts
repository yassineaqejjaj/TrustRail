import { z } from "zod";

export const APPROVAL_DEFAULT_TTL_SECONDS = 900;

export const decideApprovalRequestSchema = z
  .object({
    reason: z.string().max(1000).default(""),
  })
  .strict();

export type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;
