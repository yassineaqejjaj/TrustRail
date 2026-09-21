import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { API_KEY_ENTROPY_BYTES, API_KEY_PREFIX_LENGTH, type Environment } from "@trustrail/contracts";

export interface GeneratedApiKey {
  /** The full secret, shown to the caller exactly once. Never stored. */
  secret: string;
  /** Short, non-sensitive prefix stored alongside the digest for display ("trsk_sandbox_AB12CD34..."). */
  prefix: string;
  /** SHA-256 digest of the full secret, hex-encoded. This is what gets stored. */
  digest: string;
}

/**
 * Generates a >=256-bit random agent credential (docs/PRODUCT_SPEC.md
 * section 4). The secret is shown once by the caller and never persisted;
 * only its SHA-256 digest, a display prefix, and metadata are stored.
 */
export function generateApiKey(environment: Environment): GeneratedApiKey {
  const random = randomBytes(API_KEY_ENTROPY_BYTES).toString("base64url");
  const secret = `trsk_${environment}_${random}`;
  const prefix = secret.slice(0, secret.indexOf("_", secret.indexOf("_", 5) + 1) + API_KEY_PREFIX_LENGTH + 1);
  const digest = digestApiKey(secret);
  return { secret, prefix, digest };
}

export function digestApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Constant-time comparison of two digests (both are fixed-length hex, but compare safely regardless). */
export function digestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
