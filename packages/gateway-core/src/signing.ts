import type { JWK } from "jose";

/**
 * The shape of a signing key usable to issue receipts (gateway/dispatch and
 * receiptBuilder). Deliberately just the in-memory shape -- how it's
 * fetched/cached (currently `apps/api/src/gateway/keys.ts`, which is
 * DB-schema-coupled and stays in apps/api) is up to the caller. Defined
 * here, rather than in apps/api, so this package's own types don't reach
 * back into apps/api for it.
 */
export interface ActiveSigningKey {
  kid: string;
  privateJwk: JWK;
}
