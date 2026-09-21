import { DEMO_ORDERS } from "@trustrail/contracts";
import type { Db } from "./db/client.js";
import { orders, refunds } from "./db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Idempotent: safe to run repeatedly. Deletes and recreates only the demo
 * organization's fixture orders/refunds, per docs/PRODUCT_SPEC.md section
 * 14 ("A reset clears only an explicitly isolated local demo workspace").
 */
export async function seedMerchantSandbox(db: Db, organizationId: string): Promise<void> {
  const orderIds = DEMO_ORDERS.map((o) => o.id);
  for (const id of orderIds) {
    await db.delete(refunds).where(eq(refunds.orderId, id));
    await db.delete(orders).where(eq(orders.id, id));
  }
  for (const fixture of DEMO_ORDERS) {
    await db.insert(orders).values({
      id: fixture.id,
      organizationId,
      customerRef: fixture.customerRef,
      amountMinor: fixture.amountMinor,
      currency: fixture.currency,
      originalPaymentDestination: fixture.originalPaymentDestination,
      disputed: fixture.disputed,
      placedAt: new Date(Date.now() - fixture.placedDaysAgo * 86_400_000),
    });
  }
}
