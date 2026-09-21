import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant } from "../helpers.js";

/**
 * Policies page (docs/ROADMAP.md item 9): the default policy bundle that
 * organization creation seeds automatically ("EUR 100 automatic, up to
 * EUR 500 requires approval" -- the onboarding page's own copy, matching
 * packages/contracts/src/policy.ts's DEFAULT_POLICY_BUNDLE), plus the
 * real version-history / publish flow (save a new draft version, then
 * publish it).
 */
test("shows the seeded default policy and can save + publish a new version", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-policies");

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/policies`);

  await expect(page.getByText("Refund policy · sandbox")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();

  // The Policies page's <Field> labels aren't associated with their inputs
  // via htmlFor/id (unlike onboarding's), so getByLabel can't find them --
  // locate by the label text's parent instead.
  const fieldInput = (label: string) => page.getByText(label, { exact: true }).locator("xpath=..").locator("input");
  const automaticInput = fieldInput("Automatic limit (EUR)");
  const approvalInput = fieldInput("Approval limit (EUR)");

  // The default bundle's automatic/approval limits, per DEFAULT_POLICY_BUNDLE.
  await expect(automaticInput).toHaveValue("100");
  await expect(approvalInput).toHaveValue("500");

  // Exactly one published version so far, no drafts.
  await expect(page.getByText("Version history")).toBeVisible();
  await expect(page.getByText(/v1 ·/)).toBeVisible();

  // Raise the automatic limit and save a new draft version -- a real
  // change persisted through the real API, not a UI-only edit.
  await automaticInput.fill("150");
  await fieldInput("Change reason").fill("e2e: raise automatic limit");
  await page.getByRole("button", { name: "Save as new draft version" }).click();
  await expect(page.getByRole("status").getByText("Draft version saved")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/v2 ·/)).toBeVisible({ timeout: 10_000 });

  // Publish it, and confirm it becomes the active version.
  await page.getByRole("button", { name: "Publish version to sandbox" }).click();
  await expect(page.getByRole("status").getByText("Policy published")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Revision 2/)).toBeVisible({ timeout: 10_000 });

  // Reload and confirm the raised limit is now what's live.
  await page.reload();
  await expect(fieldInput("Automatic limit (EUR)")).toHaveValue("150", { timeout: 10_000 });
});
