import { z } from "zod";
import { ENVIRONMENTS } from "./enums.js";

export const createAgentRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).default(""),
    environment: z.enum(ENVIRONMENTS),
  })
  .strict();

export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .strict();

export const API_KEY_ENTROPY_BYTES = 32; // 256 bits
export const API_KEY_PREFIX_LENGTH = 8;
