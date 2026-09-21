import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant, registerOrgOwner } from "../helpers.js";

/**
 * Mobile/responsive smoke tests (docs/ROADMAP.md item 9). Runs under the
 * "mobile-chromium" Playwright project (playwright.config.ts), which
 * emulates a 375x812 viewport -- these tests are testMatch-scoped to this
 * file only, so every other spec still runs once, at the default desktop
 * size, exactly as before.
 */

test("dashboard sidebar collapses into the mobile drawer at 375px", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-responsive-dashboard");

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/dashboard`);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible({ timeout: 10_000 });

  // The persistent desktop sidebar ("hidden md:flex") must not be visible
  // -- its nav links should only appear once the drawer is opened.
  await expect(page.getByRole("link", { name: "Delegations" })).not.toBeVisible();

  // Once open, two <Sidebar> copies exist in the DOM (the persistent,
  // still-hidden desktop one and the drawer's) -- scope to the drawer
  // itself (it's the only ancestor the "Close navigation" button shares
  // with the sidebar links) to avoid an ambiguous match.
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.locator("div", { has: page.getByRole("button", { name: "Close navigation" }) }).last();
  await expect(drawer.getByRole("link", { name: "Delegations" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Policies" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Settings" })).toBeVisible();

  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(page.getByRole("link", { name: "Delegations" })).not.toBeVisible();
});

test("marketing landing page's mobile hamburger menu works", async ({ page }) => {
  const state = loadState();
  await page.goto(`${state.webBaseUrl}/`);

  // Desktop nav links are hidden below md; the hamburger button is the
  // only way to reach them.
  await expect(page.getByRole("link", { name: "Docs", exact: true })).not.toBeVisible();
  const openMenu = page.getByRole("button", { name: "Open menu" });
  await expect(openMenu).toBeVisible();

  await openMenu.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  // The desktop <nav> (still "hidden" below md) keeps its own "Docs" link in
  // the DOM, so the mobile menu's copy -- rendered after it -- is the last match.
  const mobileDocsLink = page.getByRole("link", { name: "Docs", exact: true }).last();
  await expect(mobileDocsLink).toBeVisible();

  await mobileDocsLink.click();
  await expect(page).toHaveURL(/\/docs$/);
});

test("onboarding wizard progress steps remain usable at 375px width", async ({ page }) => {
  const state = loadState();
  // A bare org (no pre-seeded agent) so the checklist is still on its
  // early, not-yet-completed steps -- "Register an agent" is what a real
  // first-time user sees here, not a fait-accompli "E2E Agent" button.
  const org = await registerOrgOwner(state, "e2e-responsive-onboarding");

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  // The org already exists (seeded above), so signing in lands straight on
  // the checklist -- wait for it, then confirm all five progress-bar step
  // labels render and are visible without the page needing horizontal
  // scroll to reach them.
  await expect(page.getByRole("button", { name: "Register an agent" })).toBeVisible({ timeout: 10_000 });
  for (const label of ["Agent", "Credential", "Grant", "Test run"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // "Organization" also labels the summary header above the checklist, so
  // the progress-bar step (rendered after it) is the last match.
  await expect(page.getByText("Organization", { exact: true }).last()).toBeVisible();

  // And the flow underneath is genuinely usable at this width, not just
  // visible: register a real agent through it.
  await page.getByRole("button", { name: "Register an agent" }).click();
  await page.getByLabel("Agent name").fill("Mobile E2E Agent");
  await page.getByRole("button", { name: "Register agent" }).click();
  await expect(page.getByText("Mobile E2E Agent")).toBeVisible({ timeout: 10_000 });
});
