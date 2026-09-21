import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { orders, refunds } from "./db/schema.js";
import { newRefundId } from "./db/ids.js";

export interface CreateRefundInput {
  organizationId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

export type CreateRefundResult =
  | { outcome: "succeeded"; replay: boolean; refundId: string; destination: string }
  | { outcome: "order_not_found" }
  | { outcome: "currency_mismatch" }
  | { outcome: "insufficient_remaining_balance"; remainingMinor: number };

/**
 * The merchant's own enforcement: no refund may exceed the order's
 * remaining refundable balance, even under concurrent requests and even
 * across distinct TrustRail grants (docs/PRODUCT_SPEC.md section 7 and the
 * "several concurrent refunds against EUR 100 remaining" scenario in
 * section 14). Achieved with `SELECT ... FOR UPDATE` on the order row: two
 * concurrent transactions targeting the same order serialize on that lock,
 * so the second transaction always sees the first's committed refund when
 * it computes the remaining balance.
 *
 * Idempotency: `idempotencyKey` is the TrustRail action ID (per spec
 * section 7, "Use the TrustRail action ID as the connector idempotency
 * key"). A unique index on it means retrying with the same key after a
 * timeout can never create a second refund -- it always returns the
 * original result.
 */
export async function createRefund(db: Db, input: CreateRefundInput): Promise<CreateRefundResult> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing[0]) {
      const r = existing[0];
      return { outcome: "succeeded", replay: true, refundId: r.id, destination: r.destination } as const;
    }

    const orderRows = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");
    const order = orderRows[0];
    if (!order || order.organizationId !== input.organizationId) {
      return { outcome: "order_not_found" } as const;
    }
    if (order.currency !== input.currency) {
      return { outcome: "currency_mismatch" } as const;
    }

    const totals = await tx
      .select({ total: sql<string>`coalesce(sum(${refunds.amountMinor}), 0)` })
      .from(refunds)
      .where(eq(refunds.orderId, input.orderId));
    const alreadyRefunded = Number(totals[0]?.total ?? 0);
    const remaining = order.amountMinor - alreadyRefunded;

    if (input.amountMinor > remaining) {
      return { outcome: "insufficient_remaining_balance", remainingMinor: remaining } as const;
    }

    const refundId = newRefundId();
    try {
      await tx.insert(refunds).values({
        id: refundId,
        organizationId: input.organizationId,
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        amountMinor: input.amountMinor,
        currency: input.currency,
        destination: order.originalPaymentDestination,
        status: "succeeded",
      });
    } catch (err) {
      // Unique violation on idempotencyKey: a concurrent request with the
      // exact same key won the race. Return its result instead of erroring.
      const again = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1);
      if (again[0]) {
        return { outcome: "succeeded", replay: true, refundId: again[0].id, destination: again[0].destination } as const;
      }
      throw err;
    }

    return { outcome: "succeeded", replay: false, refundId, destination: order.originalPaymentDestination } as const;
  });
}
