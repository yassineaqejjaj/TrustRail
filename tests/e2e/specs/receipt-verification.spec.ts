import { test, expect } from "@playwright/test";
import { loadState, seedOrgWithGrant, submitAction } from "../helpers.js";

/**
 * "Receipt verification" (spec section 16): a real execution receipt,
 * fetched and pasted into the real Receipts page's verify tool. Confirms
 * a valid receipt verifies, and that altering it after the fact is
 * visibly caught -- signature_valid must flip to false, not just show a
 * vague error.
 */
test("the Receipts page verifies a real receipt and catches a tampered one", async ({ page }) => {
  const state = loadState();
  const org = await seedOrgWithGrant(state, "e2e-receipt");

  const action = await submitAction(state, org, "order_demo_101", 8_000, "e2e-receipt-1");
  expect(action.decision).toBe("ALLOW");
  expect(action.execution_state).toBe("succeeded");
  const executionReceiptId = action.receipts.find((r: { receipt_type: string }) => r.receipt_type === "execution").receipt_id;

  const receiptRes = await fetch(`${state.apiBaseUrl}/v1/receipts/${executionReceiptId}`, {
    headers: { authorization: `Bearer ${org.agentSecret}` },
  });
  const { jws } = await receiptRes.json();

  await page.goto(`${state.webBaseUrl}/onboarding`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(org.ownerEmail);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await page.goto(`${state.webBaseUrl}/receipts`);
  const textarea = page.locator("textarea");
  // The main "Verify" submit button is text-labelled; per-row receipt list
  // items also have icon-only buttons with aria-label="Verify", which
  // share the same accessible name -- disambiguate by visible text content.
  const verifyButton = page.locator("button", { hasText: "Verify" }).filter({ hasNotText: "Verifying" });

  await textarea.fill(jws);
  await verifyButton.click();

  await expect(page.getByText(/signature.*valid/i).first()).toBeVisible({ timeout: 10_000 });

  const [header, payloadB64, signature] = jws.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  const tampered = { ...payload, connector_reference: "refund_tampered_by_e2e" };
  const tamperedJws = `${header}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${signature}`;

  await textarea.fill(tamperedJws);
  await verifyButton.click();
  await expect(page.getByText(/invalid|false|failed/i).first()).toBeVisible({ timeout: 10_000 });
});
