import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant, registerUser } from "../helpers.js";

/**
 * Settings page (docs/ROADMAP.md item 9): org info, connector/signing-key
 * status, and the real membership/role-management form. There is no
 * email-invite flow in V1 (the page says so itself: "The user must
 * already have a TrustRail account") -- "inviting" a member here really
 * means attaching a role to an existing account, which IS implemented
 * end-to-end (apps/api/src/routes/memberships.ts), so this spec exercises
 * that real flow instead of a fabricated invite-by-email one.
 */
test("shows org info and can add + change a member's role", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-settings");
  const teammate = await registerUser(state, "e2e-settings-teammate");

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/settings`);

  // Org info / environment panel.
  await expect(page.getByText("e2e-settings Org")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("owner", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("sandbox", { exact: true })).toBeVisible();
  await expect(page.getByText(state.apiBaseUrl)).toBeVisible();
  await expect(page.getByText(/API reports ready/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/public key\(s\) published/)).toBeVisible({ timeout: 10_000 });

  // Only the owner is a member so far.
  await expect(page.getByText(org.ownerEmail)).toBeVisible();

  const roleSelect = page.locator("select");

  // Add the existing teammate account as a Viewer.
  await page.getByPlaceholder("teammate@company.com").fill(teammate.email);
  await roleSelect.selectOption("viewer");
  await page.getByRole("button", { name: "Save membership" }).click();
  await expect(page.getByRole("status").getByText("Membership updated")).toBeVisible({ timeout: 10_000 });

  const teammateRow = page.locator("li", { hasText: teammate.email });
  await expect(teammateRow).toBeVisible();
  await expect(teammateRow.getByText("viewer")).toBeVisible();

  // Real role management: change the same member's role to Approver and
  // confirm the tag updates (memberships.ts upserts by email, spec
  // section 13's "role management").
  await page.getByPlaceholder("teammate@company.com").fill(teammate.email);
  await roleSelect.selectOption("approver");
  await page.getByRole("button", { name: "Save membership" }).click();
  await expect(page.getByRole("status").getByText("Membership updated").last()).toBeVisible({ timeout: 10_000 });
  await expect(teammateRow.getByText("approver")).toBeVisible({ timeout: 10_000 });
  await expect(teammateRow.getByText("viewer")).toHaveCount(0);
});
