import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant, createAgent, createChildGrant } from "../helpers.js";

/**
 * Delegations page (docs/ROADMAP.md item 9). There is no "create child
 * grant" flow anywhere in the dashboard UI -- child grants can only be
 * issued by an authenticated *agent* calling POST /v1/grants directly (see
 * apps/api/src/routes/grants.ts: "a child grant must be issued by the
 * parent grant's authenticated agent"), which no page exposes a form for.
 * So this spec seeds a real root + child grant over the API (mirroring
 * how an agent SDK would delegate) and exercises the page's real,
 * existing features against that real hierarchy: the tree/table views and
 * the revoke flow.
 */
test("renders the org's grant hierarchy and revokes a grant from the UI", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-delegations", { delegationAllowed: true, maxRemainingDepth: 2 });
  const child = await createAgent(state, org, "E2E Child Agent");
  const childGrant = await createChildGrant(state, org, child.agentId, { max_amount_minor: 20_000 });

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/delegations`);

  // Tree view: both the root grant (E2E Agent) and its child (E2E Child
  // Agent) should render, with the child nested under the root.
  await expect(page.getByText("E2E Agent").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("E2E Child Agent")).toBeVisible();
  await expect(page.getByText("root").first()).toBeVisible();

  // Selecting the child node shows its raw detail, including the
  // delegation depth and the effective per-action limit we set above.
  // Scoped to a button (the tree node itself), since once selected the
  // detail panel's own "Subject agent" row repeats the same name as plain
  // text.
  const childTreeNode = page.getByRole("button", { name: /E2E Child Agent/ });
  await childTreeNode.click();
  await expect(page.getByText("Grant detail")).toBeVisible();
  await expect(page.getByText(/up to \d+ more hop\(s\)|not allowed/)).toBeVisible();
  await expect(page.getByText("€200.00", { exact: true })).toBeVisible();

  // Table view: the same two grants, with a Root/Child type column.
  await page.getByRole("tab", { name: "Table" }).click();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "Root", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Child", exact: true })).toBeVisible();
  expect(childGrant.grantId.length).toBeGreaterThan(0);

  // Revoke the child grant through the real UI flow (ConfirmDialog with a
  // required reason). The detail panel with the revoke button only renders
  // in the Tree tab, so re-select the child grant there first.
  await page.getByRole("tab", { name: "Tree" }).click();
  await childTreeNode.click();
  await page.getByRole("button", { name: /Revoke grant/ }).first().click();
  await page.getByLabel("Reason").fill("e2e: no longer needed");
  await page.getByRole("button", { name: /^Revoke grant$/ }).last().click();

  await expect(page.getByRole("status").getByText("Grant revoked")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator("table tbody tr").filter({ hasText: childGrant.grantId }).getByText("revoked")).toBeVisible({ timeout: 10_000 });
});
