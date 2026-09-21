import type { HttpClient } from "../http.js";
import type { ReceiptRecord, ReceiptVerificationResult } from "../types.js";

export class ReceiptsResource {
  constructor(private readonly http: HttpClient) {}

  /** Requires the caller's own session/credential to be scoped to the receipt's organization. */
  async get(receiptId: string): Promise<ReceiptRecord> {
    return this.http.request<ReceiptRecord>({ method: "GET", path: `/v1/receipts/${encodeURIComponent(receiptId)}` });
  }

  /**
   * Verifies a receipt's signature against TrustRail's own published keys.
   * Deliberately does not require authentication -- this is meant to work
   * for anyone holding a receipt JWS, independent of a TrustRail account.
   * Report `signature_valid`, `issuer_trusted`, and `key_status`
   * separately; do not collapse them into a single boolean (see
   * docs/PRODUCT_SPEC.md section 9).
   */
  async verify(jws: string): Promise<ReceiptVerificationResult> {
    return this.http.request<ReceiptVerificationResult>({ method: "POST", path: "/v1/receipts/verify", body: { jws } });
  }
}
