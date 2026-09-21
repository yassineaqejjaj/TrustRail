import { randomBytes, createHash } from "node:crypto";

export const SESSION_COOKIE_NAME = "trustrail_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const CSRF_HEADER_NAME = "x-trustrail-csrf";

export interface GeneratedSessionToken {
  token: string;
  digest: string;
}

export function generateSessionToken(): GeneratedSessionToken {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
