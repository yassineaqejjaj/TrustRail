import { desc, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import type { JWK } from "jose";
import type { Db } from "../db/client.js";
import { signingKeys } from "../db/schema.js";
import type { TrustedKey } from "@trustrail/receipt-verifier";

export interface ActiveSigningKey {
  kid: string;
  privateJwk: JWK;
}

/**
 * Signing keys: the database stores only a public JWK and a *reference* to
 * where the private key material lives (a local file path in this V1;
 * `infra/keys/` is mounted privately and excluded from Git). Never the
 * private key bytes themselves -- docs/PRODUCT_SPEC.md section 9 ("Provide
 * a signer interface for later KMS use... never plaintext private keys" in
 * the database).
 */
export async function getActiveSigningKey(db: Db): Promise<ActiveSigningKey> {
  const rows = await db.select().from(signingKeys).where(eq(signingKeys.status, "active")).orderBy(desc(signingKeys.createdAt)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("no active signing key configured -- run pnpm setup:local");
  const privateJwk = loadPrivateKeyFromRef(row.privateKeyRef);
  return { kid: row.kid, privateJwk };
}

export async function getTrustedKeys(db: Db): Promise<TrustedKey[]> {
  const rows = await db.select().from(signingKeys);
  return rows.map((r) => ({ kid: r.kid, publicJwk: r.publicKeyJwk as JWK, status: r.status as TrustedKey["status"] }));
}

export async function getPublicJwks(db: Db): Promise<JWK[]> {
  const rows = await db.select().from(signingKeys);
  return rows.filter((r) => r.status !== "revoked").map((r) => r.publicKeyJwk as JWK);
}

function loadPrivateKeyFromRef(ref: string): JWK {
  if (!ref.startsWith("file:")) {
    throw new Error(`unsupported private key reference scheme: ${ref}`);
  }
  const filePath = ref.slice("file:".length);
  return JSON.parse(readFileSync(filePath, "utf8"));
}
