/**
 * Signs a fixed sample receipt payload with the real TrustRail signer
 * (@trustrail/receipt-verifier) and writes the result to
 * fixtures/cross-language-receipt.json, which is checked into git.
 *
 * This lets sdk/python's test suite verify a receipt that was actually
 * signed by the TypeScript implementation without needing Node available
 * at Python test time -- satisfying spec section 16's "SDK contract tests
 * run against the real API; Python and TypeScript verify a common signed
 * fixture." Re-run this script (`pnpm tsx tests/integration/generate-cross-language-receipt-fixture.ts`)
 * only if the receipt payload schema changes.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSigningKeyPair, signReceipt, verifyReceiptJws } from "@trustrail/receipt-verifier";
import type { ReceiptPayload } from "@trustrail/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const keys = await generateSigningKeyPair();

  const payload: ReceiptPayload = {
    schema_version: "1",
    receipt_type: "execution",
    receipt_id: "rcpt_crosslangfixture0001",
    issuer: "trustrail-fixture",
    organization_id: "org_crosslangfixture00001",
    environment: "sandbox",
    action_id: "act_crosslangfixture00001",
    actor_id: "agt_crosslangfixture00001",
    principal_id: "usr_crosslangfixture00001",
    delegation_chain_ids: ["grant_crosslangfixture001"],
    action: "refund.create",
    resource_id: "order_demo_101",
    request_hash: "sha256:" + "a".repeat(64),
    policy_version_id: "polv_crosslangfixture0001",
    policy_hash: "sha256:" + "b".repeat(64),
    decision: "ALLOW",
    reason_codes: [],
    approval_id: null,
    outcome: "succeeded",
    connector_reference: "refund_crosslangfixture01",
    recorded_at: "2026-09-21T12:00:00.000Z",
  };

  const jws = await signReceipt(payload, keys.privateJwk, keys.kid);

  // Sanity check before writing the fixture: the TS verifier must accept
  // what the TS signer just produced.
  const check = await verifyReceiptJws(jws, [{ kid: keys.kid, publicJwk: keys.publicJwk, status: "active" }]);
  if (!check.signature_valid) {
    throw new Error("generated fixture does not verify against its own key -- refusing to write it");
  }

  const fixture = {
    description: "A receipt signed by @trustrail/receipt-verifier (TypeScript). Used by sdk/python's cross-language test to prove both implementations agree byte-for-byte on RFC 8785 canonicalization and Ed25519 verification.",
    kid: keys.kid,
    public_jwk: keys.publicJwk,
    jws,
    payload,
  };

  const outPath = path.join(__dirname, "fixtures", "cross-language-receipt.json");
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
