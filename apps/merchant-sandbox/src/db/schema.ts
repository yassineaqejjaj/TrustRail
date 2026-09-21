import { pgSchema, text, integer, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * The sandbox merchant lives in its own PostgreSQL schema, separate from
 * TrustRail's own tables (docs/PRODUCT_SPEC.md section 10: "Sandbox
 * merchant tables live in its own database/schema"). It is a synthetic
 * fixture merchant, not a real payment processor -- see
 * docs/PRODUCT_SPEC.md section 1 ("Money is represented in a synthetic
 * merchant sandbox. No real funds move in the demo.").
 */
export const merchantSchema = pgSchema("merchant_sandbox");

export const orders = merchantSchema.table("orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  customerRef: text("customer_ref").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  originalPaymentDestination: text("original_payment_destination").notNull(),
  disputed: boolean("disputed").notNull().default(false),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("merchant_orders_org_idx").on(t.organizationId),
}));

export const refunds = merchantSchema.table("refunds", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  destination: text("destination").notNull(),
  status: text("status").notNull().default("succeeded"), // succeeded | failed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idempotencyUnique: uniqueIndex("merchant_refunds_idempotency_unique").on(t.idempotencyKey),
  orderIdx: index("merchant_refunds_order_idx").on(t.orderId),
}));
