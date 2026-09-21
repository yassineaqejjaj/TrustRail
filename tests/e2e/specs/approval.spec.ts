import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant, addApprover, submitAction } from "../helpers.js";

/**
 * "Independent reviewer approval" (spec section 16): a real action that
 * requires approval, approved by a genuinely different, independently
 * logged-in reviewer through the real Approvals page.
 */
test("an independent reviewer approves a EUR 350 request through the dashboard", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-approval");
  const approver = await addApprover(state, org, "e2e-approval-reviewer");

  const action = await submitAction(state, org, "order_demo_102", 35_000, "e2e-approval-1");
  expect(action.decision).toBe("REQUIRE_APPROVAL");
  expect(action.execution_state).toBe("awaiting_approval");

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(approver.email);
  await page.getByLabel("Password").fill(approver.password);
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/approvals`);
  await expect(page.getByText("order_demo_102")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Approve" }).first().click();

  // Confirmation dialog, if the UI has one for this destructive-ish action.
  const confirmButton = page.getByRole("button", { name: /^Approve$/ }).last();
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click();
  }

  await expect(page.getByText(/No approvals pending|order_demo_102.*Approved/i)).toBeVisible({ timeout: 10_000 });

  await page.goto(`${state.webBaseUrl}/actions/${action.action_id}`);
  await expect(page.getByText(/Succeeded/i)).toBeVisible({ timeout: 10_000 });
});
