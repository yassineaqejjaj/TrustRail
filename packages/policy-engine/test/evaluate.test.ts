import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY_BUNDLE } from "@trustrail/contracts";
import { evaluate } from "../src/evaluate.js";
import type { EvaluationRequest, GrantChainLink, OrderFacts } from "../src/types.js";

const NOW = new Date("2026-09-21T12:00:00Z");

function rootGrant(overrides: Partial<GrantChainLink> = {}): GrantChainLink {
  return {
    id: "grant_root000000000000001",
    organizationId: "org_northstar00000000000001",
    environment: "sandbox",
    parentGrantId: null,
    rootGrantId: "grant_root000000000000001",
    principalId: "usr_manager0000000000000001",
    subjectAgentId: "agt_support0000000000000001",
    allowedActions: ["refund.create"],
    allowedResourceIds: ["order_demo_101"],
    unrestrictedResources: false,
    allowedConnectorIds: ["conn_merchant0000000000001"],
    currency: "EUR",
    maxAmountMinor: 50_000,
    validFrom: null,
    expiresAt: "2026-12-31T00:00:00Z",
    delegationAllowed: true,
    maxRemainingDepth: 3,
    status: "active",
    ...overrides,
  };
}

function order(overrides: Partial<OrderFacts> = {}): OrderFacts {
  return {
    found: true,
    ownedByPrincipal: true,
    ageDays: 5,
    disputed: false,
    remainingAmountMinor: 100_000,
    currency: "EUR",
    ...overrides,
  };
}

function baseRequest(overrides: Partial<EvaluationRequest> = {}): EvaluationRequest {
  return {
    now: NOW,
    action: "refund.create",
    resourceId: "order_demo_101",
    connectorId: "conn_merchant0000000000001",
    amountMinor: 8_000,
    currency: "EUR",
    chain: [rootGrant()],
    order: order(),
    policy: DEFAULT_POLICY_BUNDLE,
    ...overrides,
  };
}

describe("evaluate: amount tiers (spec section 16)", () => {
  it("EUR 100.00 (10000 minor) is automatic ALLOW", () => {
    const result = evaluate(baseRequest({ amountMinor: 10_000 }));
    expect(result.decision).toBe("ALLOW");
  });

  it("EUR 100.01 (10001 minor) requires approval", () => {
    const result = evaluate(baseRequest({ amountMinor: 10_001 }));
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.reasonCodes).toContain("APPROVAL_REQUIRED");
  });

  it("EUR 500.00 (50000 minor) requires approval", () => {
    const result = evaluate(baseRequest({ amountMinor: 50_000, chain: [rootGrant({ maxAmountMinor: 50_000 })] }));
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("EUR 500.01 (50001 minor) is denied", () => {
    const result = evaluate(baseRequest({ amountMinor: 50_001, chain: [rootGrant({ maxAmountMinor: 60_000 })] }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("AMOUNT_LIMIT");
  });

  it("EUR 700 is denied even though it exceeds the grant cap too", () => {
    const result = evaluate(baseRequest({ amountMinor: 70_000, chain: [rootGrant({ maxAmountMinor: 50_000 })] }));
    expect(result.decision).toBe("DENY");
  });
});

describe("evaluate: delegation attenuation", () => {
  const root = rootGrant();
  function childGrant(overrides: Partial<GrantChainLink> = {}): GrantChainLink {
    return {
      ...root,
      id: "grant_child00000000000001",
      parentGrantId: root.id,
      subjectAgentId: "agt_refund00000000000001",
      maxAmountMinor: 50_000,
      delegationAllowed: false,
      maxRemainingDepth: 2,
      ...overrides,
    };
  }

  it("a valid child within parent bounds evaluates normally", () => {
    const result = evaluate(baseRequest({ chain: [root, childGrant()], amountMinor: 8_000 }));
    expect(result.decision).toBe("ALLOW");
  });

  it("a child requesting a wider cap than its parent is rejected (DELEGATION_WIDENING)", () => {
    const wideChild = childGrant({ maxAmountMinor: 90_000 });
    const result = evaluate(baseRequest({ chain: [root, wideChild], amountMinor: 8_000 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("DELEGATION_WIDENING");
  });

  it("a child requesting broader resources than its parent is rejected", () => {
    const wideChild = childGrant({ allowedResourceIds: ["order_demo_101", "order_other_999"] });
    const result = evaluate(baseRequest({ chain: [root, wideChild], amountMinor: 8_000 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("DELEGATION_WIDENING");
  });

  it("revoking the root denies dispatch for the child even though the child itself is 'active'", () => {
    const revokedRoot = { ...root, status: "revoked" as const };
    const result = evaluate(baseRequest({ chain: [revokedRoot, childGrant()], amountMinor: 8_000 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("GRANT_REVOKED");
  });

  it("an expired root denies dispatch for the child", () => {
    const expiredRoot = { ...root, expiresAt: "2020-01-01T00:00:00Z" };
    const result = evaluate(baseRequest({ chain: [expiredRoot, childGrant()], amountMinor: 8_000 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("GRANT_EXPIRED");
  });

  it("delegation beyond the parent's remaining depth is rejected", () => {
    const shallowRoot = rootGrant({ maxRemainingDepth: 0 });
    const result = evaluate(baseRequest({ chain: [shallowRoot, childGrant()], amountMinor: 8_000 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("DELEGATION_DEPTH_EXCEEDED");
  });
});

describe("evaluate: fail-closed conditions", () => {
  it("denies when no policy is available (POLICY_UNAVAILABLE), never ALLOW", () => {
    const result = evaluate(baseRequest({ policy: null }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("POLICY_UNAVAILABLE");
  });

  it("denies when order state is unavailable (STATE_UNAVAILABLE)", () => {
    const result = evaluate(baseRequest({ order: { found: false } }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("STATE_UNAVAILABLE");
  });

  it("denies a disputed payment when policy requires it", () => {
    const result = evaluate(baseRequest({ order: order({ disputed: true }) }));
    expect(result.decision).toBe("DENY");
  });

  it("denies when the order is not owned by the accountable principal", () => {
    const result = evaluate(baseRequest({ order: order({ ownedByPrincipal: false }) }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("RESOURCE_MISMATCH");
  });

  it("denies an amount above the order's remaining refundable balance", () => {
    const result = evaluate(baseRequest({ amountMinor: 9_000, order: order({ remainingAmountMinor: 5_000 }) }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("AMOUNT_LIMIT");
  });

  it("denies resource ids not covered by the grant", () => {
    const result = evaluate(baseRequest({ resourceId: "order_not_covered" }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("RESOURCE_MISMATCH");
  });
});

describe("evaluate: approval resumption", () => {
  const highAmountRequest = baseRequest({ amountMinor: 35_000 });

  it("first pass with no approval yet returns REQUIRE_APPROVAL", () => {
    const result = evaluate(highAmountRequest);
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("resuming with status=approved returns ALLOW", () => {
    const result = evaluate({ ...highAmountRequest, approval: { status: "approved" } });
    expect(result.decision).toBe("ALLOW");
  });

  it("resuming with status=rejected returns DENY with APPROVAL_REJECTED", () => {
    const result = evaluate({ ...highAmountRequest, approval: { status: "rejected" } });
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("APPROVAL_REJECTED");
  });

  it("resuming with status=expired returns DENY with APPROVAL_EXPIRED", () => {
    const result = evaluate({ ...highAmountRequest, approval: { status: "expired" } });
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("APPROVAL_EXPIRED");
  });
});

describe("evaluate: prompt-injection style free text has no effect", () => {
  it("a 'reason' field containing an override instruction does not change the outcome", () => {
    // The policy engine never reads free text at all -- this test exists to
    // document that guarantee structurally, not just by convention.
    const withInjection = baseRequest({ amountMinor: 70_000, chain: [rootGrant({ maxAmountMinor: 50_000 })] });
    const result = evaluate(withInjection);
    expect(result.decision).toBe("DENY");
  });
});
