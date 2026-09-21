import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant, submitAction } from "../helpers.js";

/**
 * "Denial explanation" (spec section 16): a real agent request that
 * TrustRail actually denies (submitted over the real API, exactly as an
 * agent/SDK would), then verified through the real dashboard that the
 * reason is clearly explained to a human reviewer.
 */
test("a denied action shows a clear reason in the dashboard", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-denial");

  // order_demo_103 is seeded at EUR 800.00; EUR 700.00 is within the order's
  // own balance but above the grant/policy's hard approval ceiling (EUR 500) --
  // a clean AMOUNT_LIMIT denial.
  const action = await submitAction(state, org, "order_demo_103", 70_000, "e2e-denial-1");
  expect(action.decision).toBe("DENY");
  expect(action.reason_codes).toContain("AMOUNT_LIMIT");

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/actions/${action.action_id}`);
  await expect(page.getByText("Denied").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/AMOUNT_LIMIT/)).toBeVisible();
});
