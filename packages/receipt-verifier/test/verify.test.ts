import { describe, expect, it, beforeAll } from "vitest";
import type { ReceiptPayload } from "@trustrail/contracts";
import { generateSigningKeyPair, signReceipt, verifyReceiptJws, type GeneratedKeyPair } from "../src/index.js";

function samplePayload(overrides: Partial<ReceiptPayload> = {}): ReceiptPayload {
  return {
    schema_version: "1",
    receipt_type: "execution",
    receipt_id: "rcpt_abcdefghijklmnopqrstuv",
    issuer: "trustrail-local",
    organization_id: "org_northstar00000000000001",
    environment: "sandbox",
    action_id: "act_abcdefghijklmnopqrstuv",
    actor_id: "agt_abcdefghijklmnopqrstuv",
    principal_id: "usr_abcdefghijklmnopqrstuv",
    delegation_chain_ids: ["grant_abcdefghijklmnopqrstuv"],
    action: "refund.create",
    resource_id: "order_demo_101",
    request_hash: "sha256:" + "a".repeat(64),
    policy_version_id: "polv_abcdefghijklmnopqrstuv",
    policy_hash: "sha256:" + "b".repeat(64),
    decision: "ALLOW",
    reason_codes: [],
    approval_id: null,
    outcome: "succeeded",
    connector_reference: "refund_demo_001",
    recorded_at: "2026-09-21T12:00:00Z",
    ...overrides,
  };
}

describe("receipt signing and verification", () => {
  let keys: GeneratedKeyPair;

  beforeAll(async () => {
    keys = await generateSigningKeyPair();
  });

  it("a validly signed receipt verifies successfully", async () => {
    const payload = samplePayload();
    const jws = await signReceipt(payload, keys.privateJwk, keys.kid);
    const result = await verifyReceiptJws(jws, [{ kid: keys.kid, publicJwk: keys.publicJwk, status: "active" }]);
    expect(result.signature_valid).toBe(true);
    expect(result.issuer_trusted).toBe(true);
    expect(result.key_status).toBe("active");
    expect(result.errors).toEqual([]);
    expect(result.payload?.receipt_id).toBe(payload.receipt_id);
  });

  it("an altered payload (amount changed after signing) fails verification", async () => {
    const payload = samplePayload();
    const jws = await signReceipt(payload, keys.privateJwk, keys.kid);
    const [header, , signature] = jws.split(".");
    const tamperedPayload = { ...payload, connector_reference: "refund_demo_999" };
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    const tamperedJws = `${header}.${tamperedPayloadB64}.${signature}`;

    const result = await verifyReceiptJws(tamperedJws, [{ kid: keys.kid, publicJwk: keys.publicJwk, status: "active" }]);
    expect(result.signature_valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/tamper|signature/i);
  });

  it("an unknown issuer key is rejected", async () => {
    const payload = samplePayload();
    const jws = await signReceipt(payload, keys.privateJwk, keys.kid);
    const result = await verifyReceiptJws(jws, []); // no trusted keys configured
    expect(result.signature_valid).toBe(false);
    expect(result.issuer_trusted).toBe(false);
  });

  it("a historical receipt still verifies after the key is rotated (status: rotated, not revoked)", async () => {
    const payload = samplePayload();
    const jws = await signReceipt(payload, keys.privateJwk, keys.kid);
    const result = await verifyReceiptJws(jws, [{ kid: keys.kid, publicJwk: keys.publicJwk, status: "rotated" }]);
    expect(result.signature_valid).toBe(true);
    expect(result.issuer_trusted).toBe(true);
    expect(result.key_status).toBe("rotated");
  });

  it("reports key_status revoked while still reporting signature integrity separately", async () => {
    const payload = samplePayload();
    const jws = await signReceipt(payload, keys.privateJwk, keys.kid);
    const result = await verifyReceiptJws(jws, [{ kid: keys.kid, publicJwk: keys.publicJwk, status: "revoked" }]);
    expect(result.signature_valid).toBe(true);
    expect(result.key_status).toBe("revoked");
  });

  it("rejects a malformed JWS outright", async () => {
    const result = await verifyReceiptJws("not-a-jws", [{ kid: keys.kid, publicJwk: keys.publicJwk, status: "active" }]);
    expect(result.signature_valid).toBe(false);
  });
});
