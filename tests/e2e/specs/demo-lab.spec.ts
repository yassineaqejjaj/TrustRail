import { test, expect } from "@playwright/test";
import { loadState, seedNorthstarDemo } from "../helpers.js";

/**
 * Demo Lab (docs/ROADMAP.md item 9): apps/api/src/demo/scenarios.ts's full
 * set of named, deterministic scenarios, run for real through the actual
 * "Run scenario" button on apps/web/src/app/(app)/demo/page.tsx --
 * exactly as the product's own demo lab note describes, "only inside the
 * seeded Northstar Commerce organization". A brand-new e2e Postgres has no
 * such organization yet, so this spec seeds it directly (same
 * seedNorthstarCommerce() the route and `pnpm demo:seed` both use) before
 * signing in as owner@northstar.demo.
 *
 * Covers 8 of the 12 scenarios; each one's outcome is observed the same
 * way a real user would: the success/failure toast, and (where the
 * scenario produces one) the resulting row in "Real recorded activity".
 * child_cap_rejected, idempotency_conflict, receipt_tamper_detected and
 * concurrent_budget_limit are not covered here -- they either produce no
 * persisted action (nothing new to see in the table beyond the toast,
 * already exercised by direct_merchant_write_rejected below) or overlap
 * with dedicated coverage elsewhere (denial.spec.ts, receipt-verification.spec.ts).
 */
test("runs eight Demo Lab scenarios and shows their real outcomes", async ({ page }) => {
  test.setTimeout(120_000);
  const state = loadState();
  const seed = await seedNorthstarDemo(state);

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(seed.ownerEmail);
  await page.getByLabel("Password").fill(seed.ownerPassword);
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/demo`);
  await expect(page.getByRole("heading", { name: "Demo lab" })).toBeVisible({ timeout: 10_000 });

  async function runAndExpectSuccess(cardTitle: string) {
    const card = page.locator(".glass", { hasText: cardTitle });
    await card.getByRole("button", { name: "Run scenario" }).click();
    await expect(page.getByRole("status").getByText("Scenario completed as expected")).toBeVisible({ timeout: 20_000 });
    // Dismiss so the next scenario's toast isn't confused with a stale one.
    await page.getByRole("status").getByLabel("Dismiss notification").last().click();
    await page.reload();
  }

  // 1. EUR 80 eligible refund -- automatic ALLOW, executed immediately.
  await runAndExpectSuccess("EUR 80 eligible refund");
  {
    const row = page.locator("table tbody tr", { hasText: "order_demo_101" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Allowed")).toBeVisible();
    await expect(row.getByText("Succeeded")).toBeVisible();
  }

  // 2. EUR 350 via approval -- requires approval, then an independent
  // reviewer (scripted into the scenario itself) approves it.
  await runAndExpectSuccess("EUR 350 refund via approval");
  {
    const row = page.locator("table tbody tr", { hasText: "order_demo_102" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Succeeded")).toBeVisible();
  }

  // 3. EUR 700 refund -- above the hard cap, denied.
  await runAndExpectSuccess("EUR 700 refund");
  {
    const row = page.locator("table tbody tr", { hasText: "order_demo_103" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Denied").first()).toBeVisible();
  }

  // 4. Prompt injection -- free text never changes the policy decision.
  await runAndExpectSuccess("“Ignore the rules” prompt injection");
  {
    const row = page.locator("table tbody tr", { hasText: "order_demo_104" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Denied").first()).toBeVisible();
  }

  // 5. Root revoked before child dispatch -- denied, then restored.
  await runAndExpectSuccess("Root revoked before child dispatch");
  {
    const row = page.locator("table tbody tr", { hasText: "order_demo_106" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Denied").first()).toBeVisible();
  }

  // 6. Idempotent replay -- exactly one refund despite two identical
  // requests; the table must not show a duplicate row.
  await runAndExpectSuccess("Repeated request, same idempotency key");
  {
    const rows = page.locator("table tbody tr", { hasText: "order_demo_107" });
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
  }

  // 7. Connector timeout, reconciled -- first attempt "unknown", then
  // resolved to succeeded with no duplicate refund.
  await runAndExpectSuccess("Merchant succeeds but the connection times out");
  {
    const row = page.locator("table tbody tr", { hasText: "order_demo_111" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Succeeded")).toBeVisible();
  }

  // 8. Direct merchant write -- rejected at the connector; no TrustRail
  // action is ever created, so the toast is the only observable outcome.
  await runAndExpectSuccess("Agent attempts a direct merchant write");
});
