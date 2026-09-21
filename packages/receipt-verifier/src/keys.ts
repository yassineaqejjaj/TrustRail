import { generateKeyPair, exportJWK, calculateJwkThumbprint, type JWK } from "jose";

export interface GeneratedKeyPair {
  kid: string;
  publicJwk: JWK;
  privateJwk: JWK;
}

/**
 * Generates a fresh Ed25519 keypair for receipt signing. `kid` is the
 * RFC 7638 JWK thumbprint of the public key, so it is derived from the key
 * material itself rather than assigned arbitrarily.
 */
export async function generateSigningKeyPair(): Promise<GeneratedKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(publicJwk, "sha256");
  publicJwk.kid = kid;
  publicJwk.alg = "EdDSA";
  publicJwk.use = "sig";
  privateJwk.kid = kid;
  return { kid, publicJwk, privateJwk };
}
