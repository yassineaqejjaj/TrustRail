/**
 * Single source of truth for the deterministic demo fixtures described in
 * docs/PRODUCT_SPEC.md section 14 ("Northstar Commerce"). Both
 * `apps/merchant-sandbox`'s seed script and the root `pnpm demo:seed`
 * script import this so order IDs/amounts never drift apart between the
 * two databases.
 */

export const DEMO_ORGANIZATION_NAME = "Northstar Commerce";
export const DEMO_ORGANIZATION_SLUG = "northstar-commerce";

export const DEMO_USERS = {
  owner: { email: "owner@northstar.demo", name: "Amara Okafor", role: "owner" as const },
  supportManager: { email: "support-manager@northstar.demo", name: "Jonas Weber", role: "admin" as const },
  approver: { email: "approver@northstar.demo", name: "Priya Chandran", role: "approver" as const },
  viewer: { email: "viewer@northstar.demo", name: "Sam Rivera", role: "viewer" as const },
};

export const DEMO_AGENTS = {
  supportAgent: { name: "Support Agent", description: "First-line customer support assistant" },
  refundAgent: { name: "Refund Agent", description: "Child agent delegated narrow refund authority" },
  itOnboardingAgent: {
    name: "IT Onboarding Agent",
    description: "Provisions new hires' SaaS access per the product brief's \"prepare Léa's arrival\" mandate",
  },
};

export const DEMO_ROOT_GRANT_MAX_AMOUNT_MINOR = 50_000; // EUR 500 per-action ceiling
export const DEMO_ROOT_DAILY_BUDGET_MINOR = 100_000; // EUR 1,000/day

/**
 * The product brief's own "prepare Léa's arrival" mandate caps the
 * per-invite license spend at EUR 150 -- this is a dedicated, smaller
 * ceiling for the IT Onboarding Agent's grant, deliberately distinct from
 * DEMO_ROOT_GRANT_MAX_AMOUNT_MINOR (which models the unrelated refund use
 * case's own limits).
 */
export const DEMO_ONBOARDING_GRANT_MAX_AMOUNT_MINOR = 15_000; // EUR 150 per-action ceiling
export const DEMO_ONBOARDING_DAILY_BUDGET_MINOR = 30_000; // EUR 300/day (covers ~2 onboardings)

export interface DemoOrderFixture {
  id: string;
  customerRef: string;
  amountMinor: number;
  currency: "EUR";
  originalPaymentDestination: string;
  disputed: boolean;
  placedDaysAgo: number;
}

/**
 * The sandbox has no real per-customer identity system distinct from a
 * TrustRail organization -- every other fixture order is treated as owned
 * by whichever principal requests it (docs/BUILD_STATUS.md; roadmap item
 * "a real connector-to-principal ownership model"). This one sentinel
 * customerRef is the deliberate exception: MerchantSandboxConnector
 * reports any order carrying it as NOT owned, so `require_order_ownership`
 * has a real, demonstrable case to deny instead of being permanently
 * true. It is not a general identity-mapping solution -- see
 * apps/api/src/gateway/merchantSandboxConnector.ts.
 */
export const MISMATCHED_OWNER_CUSTOMER_REF = "cust_other_customer_not_yours";

export const DEMO_ORDERS: DemoOrderFixture[] = [
  { id: "order_demo_101", customerRef: "cust_101", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_101", disputed: false, placedDaysAgo: 3 },
  { id: "order_demo_102", customerRef: "cust_102", amountMinor: 40_000, currency: "EUR", originalPaymentDestination: "card_tok_102", disputed: false, placedDaysAgo: 5 },
  { id: "order_demo_103", customerRef: "cust_103", amountMinor: 80_000, currency: "EUR", originalPaymentDestination: "card_tok_103", disputed: false, placedDaysAgo: 2 },
  { id: "order_demo_104", customerRef: "cust_104", amountMinor: 80_000, currency: "EUR", originalPaymentDestination: "card_tok_104", disputed: false, placedDaysAgo: 1 },
  { id: "order_demo_105", customerRef: "cust_105", amountMinor: 90_000, currency: "EUR", originalPaymentDestination: "card_tok_105", disputed: false, placedDaysAgo: 4 },
  { id: "order_demo_106", customerRef: "cust_106", amountMinor: 30_000, currency: "EUR", originalPaymentDestination: "card_tok_106", disputed: false, placedDaysAgo: 6 },
  { id: "order_demo_107", customerRef: "cust_107", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_107", disputed: false, placedDaysAgo: 2 },
  { id: "order_demo_108", customerRef: "cust_108", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_108", disputed: false, placedDaysAgo: 2 },
  { id: "order_demo_109", customerRef: "cust_109", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_109", disputed: false, placedDaysAgo: 2 },
  { id: "order_demo_110", customerRef: "cust_110", amountMinor: 10_000, currency: "EUR", originalPaymentDestination: "card_tok_110", disputed: false, placedDaysAgo: 1 },
  { id: "order_demo_111", customerRef: "cust_111", amountMinor: 15_000, currency: "EUR", originalPaymentDestination: "card_tok_111", disputed: false, placedDaysAgo: 1 },
  { id: "order_demo_112", customerRef: "cust_112", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_112", disputed: false, placedDaysAgo: 1 },
  { id: "order_demo_disputed", customerRef: "cust_disputed", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_disputed", disputed: true, placedDaysAgo: 2 },
  { id: "order_demo_stale", customerRef: "cust_stale", amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_stale", disputed: false, placedDaysAgo: 90 },
  { id: "order_demo_not_owned", customerRef: MISMATCHED_OWNER_CUSTOMER_REF, amountMinor: 20_000, currency: "EUR", originalPaymentDestination: "card_tok_not_owned", disputed: false, placedDaysAgo: 2 },
];

/**
 * Single source of truth for the SaaS B2B subscription/account-management
 * action family's fixed plan slugs. Both `apps/saas-sandbox` (which
 * defensively rejects a `subscription.change_plan` targeting anything
 * outside this list) and TrustRail's own policy/connector layer (which is
 * expected to deny an ineligible plan change before it ever reaches the
 * sandbox) reference this same list so the two never drift apart.
 */
export const SAAS_PLAN_SLUGS = ["starter", "growth", "scale", "enterprise"] as const;
export type SaasPlanSlug = (typeof SAAS_PLAN_SLUGS)[number];

export interface DemoAccountFixture {
  id: string;
  organizationSlugHint?: string;
  planId: SaasPlanSlug;
  featureKeys: string[];
  userCount: number;
  adminUserCount: number;
  suspended: boolean;
  currency: "EUR";
}

/**
 * Deterministic fixture accounts for `apps/saas-sandbox`, mirroring
 * `DEMO_ORDERS` above: both the sandbox's own seed script and whoever
 * builds the demo scenario/connector on TrustRail's side import this so
 * the fixtures never drift apart between the two.
 *
 * `account_demo_lea` is the flagship fixture for a "prepare Léa's arrival"
 * onboarding demo scenario (built separately, on TrustRail's side): she is
 * invited as role "member" (not "admin") so the invite succeeds here --
 * a hypothetical admin invite for her is expected to be denied by
 * TrustRail's policy layer before it ever reaches this sandbox.
 */
export const DEMO_ACCOUNTS: DemoAccountFixture[] = [
  { id: "account_demo_lea", planId: "growth", featureKeys: [], userCount: 12, adminUserCount: 2, suspended: false, currency: "EUR" },
  { id: "account_demo_ineligible_plan", planId: "growth", featureKeys: [], userCount: 8, adminUserCount: 1, suspended: false, currency: "EUR" },
  { id: "account_demo_suspended", planId: "starter", featureKeys: [], userCount: 3, adminUserCount: 1, suspended: true, currency: "EUR" },
  { id: "account_demo_starter", planId: "starter", featureKeys: [], userCount: 2, adminUserCount: 1, suspended: false, currency: "EUR" },
  { id: "account_demo_scale", planId: "scale", featureKeys: ["advanced_reporting"], userCount: 45, adminUserCount: 4, suspended: false, currency: "EUR" },
  { id: "account_demo_enterprise", planId: "enterprise", featureKeys: ["advanced_reporting", "sso"], userCount: 210, adminUserCount: 9, suspended: false, currency: "EUR" },
];
