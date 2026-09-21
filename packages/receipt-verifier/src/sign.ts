import { CompactSign, importJWK, type JWK } from "jose";
import { canonicalJson, RECEIPT_JWS_ALG, RECEIPT_JWS_TYP, type ReceiptPayload } from "@trustrail/contracts";

/**
 * Signs a receipt payload as a compact JWS. The payload is RFC 8785
 * canonicalized first, so re-canonicalizing the same logical payload always
 * produces byte-identical input to the signature.
 */
export async function signReceipt(payload: ReceiptPayload, privateJwk: JWK, kid: string): Promise<string> {
  const key = await importJWK({ ...privateJwk, kid }, RECEIPT_JWS_ALG);
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  return new CompactSign(bytes)
    .setProtectedHeader({ alg: RECEIPT_JWS_ALG, kid, typ: RECEIPT_JWS_TYP })
    .sign(key);
}
