import { pgSchema, text, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * The sandbox SaaS provider lives in its own PostgreSQL schema, separate
 * from TrustRail's own tables and from apps/merchant-sandbox's schema --
 * same convention as docs/PRODUCT_SPEC.md section 10 ("Sandbox merchant
 * tables live in its own database/schema"), generalized to this second,
 * independent action-type family (subscription/account management rather
 * than payments). It is a synthetic fixture SaaS backend, not a real
 * billing/CRM system.
 */
export const saasSchema = pgSchema("saas_sandbox");

export const accounts = saasSchema.table("accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  planId: text("plan_id").notNull(),
  featureKeys: jsonb("feature_keys").notNull().default([]).$type<string[]>(),
  userCount: integer("user_count").notNull().default(0),
  adminUserCount: integer("admin_user_count").notNull().default(0),
  suspended: boolean("suspended").notNull().default(false),
  currency: text("currency").notNull().default("EUR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("saas_accounts_org_idx").on(t.organizationId),
}));

export const accountActions = saasSchema.table("account_actions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  arguments: jsonb("arguments").notNull(),
  status: text("status").notNull().default("succeeded"), // succeeded | failed
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idempotencyUnique: uniqueIndex("saas_account_actions_idempotency_unique").on(t.idempotencyKey),
  accountIdx: index("saas_account_actions_account_idx").on(t.accountId),
}));
