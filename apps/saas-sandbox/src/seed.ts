import { DEMO_ACCOUNTS } from "@trustrail/contracts";
import type { Db } from "./db/client.js";
import { accounts, accountActions } from "./db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Idempotent: safe to run repeatedly. Deletes and recreates only the demo
 * organization's fixture accounts/actions, mirroring
 * apps/merchant-sandbox's `seedMerchantSandbox` (per docs/PRODUCT_SPEC.md
 * section 14: "A reset clears only an explicitly isolated local demo
 * workspace").
 */
export async function seedSaasSandbox(db: Db, organizationId: string): Promise<void> {
  const accountIds = DEMO_ACCOUNTS.map((a) => a.id);
  for (const id of accountIds) {
    await db.delete(accountActions).where(eq(accountActions.accountId, id));
    await db.delete(accounts).where(eq(accounts.id, id));
  }
  for (const fixture of DEMO_ACCOUNTS) {
    await db.insert(accounts).values({
      id: fixture.id,
      organizationId,
      planId: fixture.planId,
      featureKeys: fixture.featureKeys,
      userCount: fixture.userCount,
      adminUserCount: fixture.adminUserCount,
      suspended: fixture.suspended,
      currency: fixture.currency,
    });
  }
}
