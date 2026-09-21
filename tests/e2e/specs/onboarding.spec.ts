import { test, expect } from "@playwright/test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { loadState } from "../helpers.js";
import * as merchantSchema from "../../../apps/merchant-sandbox/src/db/schema.js";
import { seedMerchantSandbox } from "../../../apps/merchant-sandbox/src/seed.js";

/**
 * Covers two of the five mandatory flows in one continuous, real browser
 * session (spec section 16): "onboarding" and "first refund". Everything
 * here is a real click against the real dashboard, backed by a real
 * running API + Postgres + merchant sandbox (tests/e2e/global-setup.ts) --
 * no mocked network responses.
 */
test("register, create an organization, register an agent, reveal a credential, issue a grant, and run a real EUR 80 refund", async ({ page }) => {
  const state = loadState();
  const email = `e2e-onboarding-${Date.now()}@example.com`;

  await page.goto(`${state.webBaseUrl}/onboarding`);

  // "Create account" mode is the default; only the submit button (inside
  // the form) needs clicking, but it shares its label with the mode-toggle
  // tab above it -- scope to the <form> to disambiguate.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Create your organization" })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Organization name").fill("E2E Onboarding Co");
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page.getByRole("heading", { name: "Organization created" })).toBeVisible({ timeout: 10_000 });

  // The dashboard doesn't seed merchant orders for a brand-new organization
  // (correctly -- see the onboarding page's own fail-closed note). Seed
  // some so step 5's action can actually succeed, using the real session
  // cookie the browser just received to discover the new org's ID.
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "trustrail_session");
  const meRes = await fetch(`${state.apiBaseUrl}/v1/me`, { headers: { cookie: `trustrail_session=${sessionCookie!.value}` } });
  const me = await meRes.json();
  const organizationId = me.memberships[0].organization_id;

  const pool = new pg.Pool({ connectionString: state.merchantMigratorUrl });
  const merchantDb = drizzle(pool, { schema: merchantSchema });
  await seedMerchantSandbox(merchantDb, organizationId);
  await pool.end();

  await page.getByRole("button", { name: "Register an agent" }).click();
  await page.getByLabel("Agent name").fill("E2E Support Agent");
  await page.getByRole("button", { name: "Register agent" }).click();

  await expect(page.getByText("Register your first agent")).toBeVisible();
  await expect(page.locator("text=E2E Support Agent")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Create credential" }).click();
  await expect(page.getByText("This secret is shown once and cannot be retrieved again.")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Issue root grant/ }).click();
  await expect(page.getByText(/Root grant issued/)).toBeVisible({ timeout: 10_000 });

  // Step 5: run a real action through the real gateway, from the real browser.
  await page.getByLabel("Order / resource ID").fill("order_demo_101");
  await page.getByLabel("Amount (EUR)").fill("80");
  await page.getByRole("button", { name: "Run action" }).click();

  await expect(page.getByText("Onboarding complete.")).toBeVisible({ timeout: 15_000 });
  // "Allow" and "Succeeded" badges -- see components/ui's DecisionBadge/ExecutionBadge.
  await expect(page.getByText(/Allow/i)).toBeVisible();
  await expect(page.getByText(/Succeeded/i)).toBeVisible();
});
