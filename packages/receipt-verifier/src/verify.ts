import { compactVerify, importJWK, type JWK, errors as joseErrors } from "jose";
import {
  RECEIPT_JWS_ALG,
  RECEIPT_JWS_TYP,
  receiptPayloadSchema,
  type ReceiptVerificationResult,
} from "@trustrail/contracts";

export interface TrustedKey {
  kid: string;
  publicJwk: JWK;
  status: "active" | "rotated" | "revoked";
}

/**
 * Verifies a receipt JWS against an explicit, externally-supplied set of
 * trusted issuer keys (e.g. fetched once from /.well-known/jwks.json and
 * pinned, or configured out of band). Never derives trust from anything
 * inside the JWS itself -- "Never trust a public key embedded by the same
 * untrusted receipt as sufficient evidence" (docs/PRODUCT_SPEC.md section 9).
 *
 * Reports cryptographic integrity (signature_valid), issuer trust
 * (issuer_trusted / key_status) and payload shape validity as independent
 * fields, per the same spec section.
 */
export async function verifyReceiptJws(
  jws: string,
  trustedKeys: TrustedKey[]
): Promise<ReceiptVerificationResult> {
  const errorsOut: string[] = [];

  const headerB64 = jws.split(".")[0];
  let kid: string | null = null;
  try {
    const header = JSON.parse(Buffer.from(headerB64 ?? "", "base64url").toString("utf8"));
    kid = typeof header.kid === "string" ? header.kid : null;
    if (header.typ !== RECEIPT_JWS_TYP) {
      errorsOut.push(`unexpected typ header: ${String(header.typ)}`);
    }
    if (header.alg !== RECEIPT_JWS_ALG) {
      errorsOut.push(`unexpected alg header: ${String(header.alg)}`);
    }
  } catch {
    return {
      signature_valid: false,
      issuer_trusted: false,
      key_id: null,
      key_status: "unknown",
      payload: null,
      errors: ["malformed JWS: could not parse protected header"],
    };
  }

  const trusted = kid ? trustedKeys.find((k) => k.kid === kid) : undefined;
  const issuerTrusted = !!trusted;
  const keyStatus = trusted ? trusted.status : "unknown";

  if (!trusted) {
    errorsOut.push(kid ? `unknown issuer key: ${kid}` : "no kid present in protected header");
    return {
      signature_valid: false,
      issuer_trusted: false,
      key_id: kid,
      key_status: "unknown",
      payload: null,
      errors: errorsOut,
    };
  }

  let payloadBytes: Uint8Array;
  try {
    const key = await importJWK(trusted.publicJwk, RECEIPT_JWS_ALG);
    const result = await compactVerify(jws, key, { algorithms: [RECEIPT_JWS_ALG] });
    payloadBytes = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      errorsOut.push("signature verification failed: payload does not match signature (tampering detected)");
    } else {
      errorsOut.push(`signature verification failed: ${(err as Error).message}`);
    }
    return {
      signature_valid: false,
      issuer_trusted: issuerTrusted,
      key_id: kid,
      key_status: keyStatus,
      payload: null,
      errors: errorsOut,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    errorsOut.push("payload is not valid JSON");
    return {
      signature_valid: true,
      issuer_trusted: issuerTrusted,
      key_id: kid,
      key_status: keyStatus,
      payload: null,
      errors: errorsOut,
    };
  }

  const parsed = receiptPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    errorsOut.push(`payload failed schema validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    return {
      signature_valid: true,
      issuer_trusted: issuerTrusted,
      key_id: kid,
      key_status: keyStatus,
      payload: null,
      errors: errorsOut,
    };
  }

  if (errorsOut.length > 0) {
    return {
      signature_valid: true,
      issuer_trusted: issuerTrusted,
      key_id: kid,
      key_status: keyStatus,
      payload: parsed.data,
      errors: errorsOut,
    };
  }

  return {
    signature_valid: true,
    issuer_trusted: issuerTrusted,
    key_id: kid,
    key_status: keyStatus,
    payload: parsed.data,
    errors: [],
  };
}
