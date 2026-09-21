import { createHash } from "node:crypto";

/**
 * Minimal RFC 8785 (JSON Canonicalization Scheme) implementation: object
 * keys sorted by UTF-16 code unit (the default behavior of `Array.sort` on
 * strings, which is what RFC 8785 requires), no whitespace, recursively
 * applied. TrustRail payloads only ever contain plain JSON values (strings,
 * finite numbers, booleans, null, arrays, objects) coming from validated
 * zod schemas, so the fuller edge cases of general-purpose canonicalizers
 * (NaN/Infinity rejection, `toJSON`, symbol handling) do not apply here.
 * Used for both receipt signing input and request-hash computation, so the
 * exact same canonicalization is used everywhere a hash is compared -- and
 * the algorithm is simple enough to reimplement identically in the Python
 * SDK's verifier (sdk/python) for cross-language byte-for-byte agreement.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalJson: NaN/Infinity are not JSON-serializable");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported value type ${typeof value}`);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function canonicalHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
