import { z } from "zod";

/**
 * All TrustRail IDs are prefixed opaque strings (e.g. `org_...`, `agt_...`).
 * This makes IDs self-describing in logs and receipts, and lets us reject
 * an ID of the wrong kind before it ever reaches a query.
 */
export function idSchema(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[a-zA-Z0-9]{20,}$`), `expected an id prefixed "${prefix}_"`);
}

export const PREFIXES = {
  organization: "org",
  user: "usr",
  membership: "mem",
  session: "ses",
  agent: "agt",
  credential: "cred",
  grant: "grant",
  policyBundle: "polb",
  policyVersion: "polv",
  connector: "conn",
  action: "act",
  idempotencyRecord: "idem",
  approval: "appr",
  budgetWindow: "bwin",
  budgetReservation: "bres",
  executionJob: "job",
  receipt: "rcpt",
  signingKey: "key",
  auditEvent: "evt",
  usageEvent: "use",
  demoRun: "demo",
} as const;
