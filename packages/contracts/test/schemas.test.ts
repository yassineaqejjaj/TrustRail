import { describe, expect, it } from "vitest";
import { amountMinorSchema } from "../src/money.js";
import { policyBundleSchema, DEFAULT_POLICY_BUNDLE } from "../src/policy.js";
import { createActionRequestSchema } from "../src/actions.js";
import { canonicalJson, canonicalHash } from "../src/canonical.js";

describe("amountMinorSchema", () => {
  it("accepts a positive integer", () => {
    expect(amountMinorSchema.safeParse(8000).success).toBe(true);
  });
  it("rejects zero", () => {
    expect(amountMinorSchema.safeParse(0).success).toBe(false);
  });
  it("rejects negative amounts", () => {
    expect(amountMinorSchema.safeParse(-100).success).toBe(false);
  });
  it("rejects decimals", () => {
    expect(amountMinorSchema.safeParse(80.5).success).toBe(false);
  });
  it("rejects overflow beyond the maximum bound", () => {
    expect(amountMinorSchema.safeParse(10_000_000_000).success).toBe(false);
  });
});

describe("policyBundleSchema", () => {
  it("accepts the documented default bundle", () => {
    expect(policyBundleSchema.safeParse(DEFAULT_POLICY_BUNDLE).success).toBe(true);
  });
  it("rejects an unknown currency", () => {
    const bad = { ...DEFAULT_POLICY_BUNDLE, currency: "USD" };
    expect(policyBundleSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects automatic_limit_minor greater than approval_limit_minor", () => {
    const bad = { ...DEFAULT_POLICY_BUNDLE, automatic_limit_minor: 60_000, approval_limit_minor: 50_000 };
    expect(policyBundleSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects unknown extra fields (strict)", () => {
    const bad = { ...DEFAULT_POLICY_BUNDLE, extra_field: true };
    expect(policyBundleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("createActionRequestSchema", () => {
  const base = {
    grant_id: "grant_abcdefghijklmnopqrstuv",
    connector_id: "conn_abcdefghijklmnopqrstuv",
    action: "refund.create",
    resource_id: "order_demo_101",
    arguments: { amount_minor: 8000, currency: "EUR", reason: "Return" },
  };

  it("accepts a well-formed request", () => {
    expect(createActionRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects caller-supplied actor_id / principal_id / allowed / role fields", () => {
    for (const field of ["actor_id", "principal_id", "allowed", "role", "policy_version"]) {
      const withInjectedField = { ...base, [field]: "attacker-supplied" };
      expect(createActionRequestSchema.safeParse(withInjectedField).success).toBe(false);
    }
  });

  it("rejects an unknown action name", () => {
    const bad = { ...base, action: "wire.transfer" };
    expect(createActionRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("canonicalJson / canonicalHash", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalJson({ a: 2, c: { y: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("produces a different hash when a value changes", () => {
    const h1 = canonicalHash({ amount_minor: 8000 });
    const h2 = canonicalHash({ amount_minor: 8001 });
    expect(h1).not.toBe(h2);
  });

  it("hash format matches sha256:<64 hex chars>", () => {
    expect(canonicalHash({ x: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
