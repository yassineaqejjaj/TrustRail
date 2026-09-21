import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Global (non-tenant-scoped) tables
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  environmentSettings: jsonb("environment_settings").notNull().default({}),
  appMode: text("app_mode").notNull().default("local"), // 'local' | 'demo' | 'production'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUnique: uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
}));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenDigest: text("token_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  userIdx: index("sessions_user_idx").on(t.userId),
  tokenDigestIdx: uniqueIndex("sessions_token_digest_idx").on(t.tokenDigest),
}));

export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // owner | admin | operator | approver | viewer
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgUserUnique: uniqueIndex("memberships_org_user_unique").on(t.organizationId, t.userId),
  orgIdx: index("memberships_org_idx").on(t.organizationId),
  userIdx: index("memberships_user_idx").on(t.userId),
}));

export const signingKeys = pgTable("signing_keys", {
  id: text("id").primaryKey(),
  kid: text("kid").notNull().unique(),
  publicKeyJwk: jsonb("public_key_jwk").notNull(),
  privateKeyRef: text("private_key_ref").notNull(),
  status: text("status").notNull().default("active"), // active | rotated | revoked
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Tenant-scoped tables. Every one of these carries organization_id and has
// an RLS policy applied in migrations/0002_row_level_security.sql pinning
// visibility to current_setting('app.current_org_id').
// ---------------------------------------------------------------------------

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  environment: text("environment").notNull(),
  status: text("status").notNull().default("active"), // active | disabled | revoked
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("agents_org_idx").on(t.organizationId),
}));

export const agentCredentials = pgTable("agent_credentials", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  prefix: text("prefix").notNull(),
  secretDigest: text("secret_digest").notNull(),
  status: text("status").notNull().default("active"), // active | rotated | revoked | expired
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revocationReason: text("revocation_reason"),
}, (t) => ({
  orgIdx: index("agent_credentials_org_idx").on(t.organizationId),
  agentIdx: index("agent_credentials_agent_idx").on(t.agentId),
  prefixIdx: index("agent_credentials_prefix_idx").on(t.prefix),
}));

export const grants = pgTable("grants", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  principalId: text("principal_id").notNull().references(() => users.id),
  issuerType: text("issuer_type").notNull(), // user | agent
  issuerId: text("issuer_id").notNull(),
  subjectAgentId: text("subject_agent_id").notNull().references(() => agents.id),
  parentGrantId: text("parent_grant_id"),
  rootGrantId: text("root_grant_id").notNull(),
  allowedActions: jsonb("allowed_actions").notNull(),
  allowedResourceIds: jsonb("allowed_resource_ids").notNull(),
  unrestrictedResources: boolean("unrestricted_resources").notNull().default(false),
  allowedConnectorIds: jsonb("allowed_connector_ids").notNull(),
  currency: text("currency").notNull(),
  maxAmountMinor: integer("max_amount_minor").notNull(),
  rootBudgetLimitMinor: integer("root_budget_limit_minor"),
  childBudgetLimitMinor: integer("child_budget_limit_minor"),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  delegationAllowed: boolean("delegation_allowed").notNull().default(false),
  maxRemainingDepth: integer("max_remaining_depth").notNull().default(0),
  status: text("status").notNull().default("active"), // active | revoked | expired
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revocationReason: text("revocation_reason"),
}, (t) => ({
  orgIdx: index("grants_org_idx").on(t.organizationId),
  parentIdx: index("grants_parent_idx").on(t.parentGrantId),
  rootIdx: index("grants_root_idx").on(t.rootGrantId),
  subjectIdx: index("grants_subject_idx").on(t.subjectAgentId),
}));

export const policyBundles = pgTable("policy_bundles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  action: text("action").notNull(),
  activeVersionId: text("active_version_id"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgEnvActionUnique: uniqueIndex("policy_bundles_org_env_action_unique").on(t.organizationId, t.environment, t.action),
}));

export const policyVersions = pgTable("policy_versions", {
  id: text("id").primaryKey(),
  policyBundleId: text("policy_bundle_id").notNull().references(() => policyBundles.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  bundle: jsonb("bundle").notNull(),
  bundleHash: text("bundle_hash").notNull(),
  status: text("status").notNull().default("draft"), // draft | published | superseded
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
  changeReason: text("change_reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => ({
  orgIdx: index("policy_versions_org_idx").on(t.organizationId),
  bundleVersionUnique: uniqueIndex("policy_versions_bundle_version_unique").on(t.policyBundleId, t.versionNumber),
}));

export const connectors = pgTable("connectors", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // e.g. 'merchant_sandbox'
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("connectors_org_idx").on(t.organizationId),
}));

export const actions = pgTable("actions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  actorAgentId: text("actor_agent_id").notNull().references(() => agents.id),
  grantId: text("grant_id").notNull(),
  rootGrantId: text("root_grant_id").notNull(),
  principalId: text("principal_id").notNull(),
  connectorId: text("connector_id").notNull(),
  action: text("action").notNull(),
  resourceId: text("resource_id").notNull(),
  arguments: jsonb("arguments").notNull(),
  requestHash: text("request_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  decision: text("decision").notNull(), // ALLOW | DENY | REQUIRE_APPROVAL
  reasonCodes: jsonb("reason_codes").notNull().default([]),
  executionState: text("execution_state").notNull(), // see EXECUTION_STATES
  policyVersionId: text("policy_version_id"),
  policyHash: text("policy_hash"),
  approvalId: text("approval_id"),
  connectorReference: text("connector_reference"),
  traceId: text("trace_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("actions_org_idx").on(t.organizationId),
  orgCreatedIdx: index("actions_org_created_idx").on(t.organizationId, t.createdAt),
  statusIdx: index("actions_status_idx").on(t.organizationId, t.executionState),
}));

export const idempotencyRecords = pgTable("idempotency_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorAgentId: text("actor_agent_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  actionId: text("action_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  scopeUnique: uniqueIndex("idempotency_scope_unique").on(t.organizationId, t.actorAgentId, t.idempotencyKey),
}));

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  requestHash: text("request_hash").notNull(),
  principalId: text("principal_id").notNull(),
  grantChainIds: jsonb("grant_chain_ids").notNull(),
  policyVersionId: text("policy_version_id").notNull(),
  policyHash: text("policy_hash").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  triggeringRule: text("triggering_rule").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | expired
  reviewerUserId: text("reviewer_user_id"),
  reviewerReason: text("reviewer_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => ({
  orgIdx: index("approvals_org_idx").on(t.organizationId),
  actionIdx: uniqueIndex("approvals_action_unique").on(t.actionId),
  pendingExpiryIdx: index("approvals_pending_expiry_idx").on(t.organizationId, t.status, t.expiresAt),
}));

export const budgetWindows = pgTable("budget_windows", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  grantId: text("grant_id").notNull(),
  windowDate: text("window_date").notNull(), // 'YYYY-MM-DD' UTC
  currency: text("currency").notNull(),
  limitMinor: integer("limit_minor").notNull(),
  reservedMinor: integer("reserved_minor").notNull().default(0),
  committedMinor: integer("committed_minor").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgGrantDateUnique: uniqueIndex("budget_windows_org_grant_date_unique").on(t.organizationId, t.grantId, t.windowDate),
  orgDateIdx: index("budget_windows_org_date_idx").on(t.organizationId, t.windowDate),
}));

export const budgetReservations = pgTable("budget_reservations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  budgetWindowId: text("budget_window_id").notNull().references(() => budgetWindows.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  status: text("status").notNull().default("reserved"), // reserved | committed | released
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => ({
  windowIdx: index("budget_reservations_window_idx").on(t.budgetWindowId),
  actionIdx: index("budget_reservations_action_idx").on(t.actionId),
}));

export const executionJobs = pgTable("execution_jobs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | leased | done | failed
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("execution_jobs_org_idx").on(t.organizationId),
  claimIdx: index("execution_jobs_claim_idx").on(t.status, t.nextAttemptAt),
  actionUnique: uniqueIndex("execution_jobs_action_unique").on(t.actionId),
}));

export const receipts = pgTable("receipts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  receiptType: text("receipt_type").notNull(), // decision | execution
  payload: jsonb("payload").notNull(),
  jws: text("jws").notNull(),
  keyId: text("key_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("receipts_org_idx").on(t.organizationId),
  actionIdx: index("receipts_action_idx").on(t.actionId),
}));

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull(), // user | agent | system
  actorId: text("actor_id"),
  event: text("event").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("audit_events_org_idx").on(t.organizationId),
  orgCreatedIdx: index("audit_events_org_created_idx").on(t.organizationId, t.createdAt),
}));

export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // authorization | execution
  actionId: text("action_id"),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("usage_events_org_idx").on(t.organizationId),
  orgCreatedIdx: index("usage_events_org_created_idx").on(t.organizationId, t.createdAt),
}));

export const demoRuns = pgTable("demo_runs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scenarioKey: text("scenario_key").notNull(),
  status: text("status").notNull().default("running"), // running | succeeded | failed
  steps: jsonb("steps").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  orgIdx: index("demo_runs_org_idx").on(t.organizationId),
}));

/**
 * RLS-enforced tables (see db/rls.sql). Notably excludes `agent_credentials`,
 * `sessions`, `users`, and `memberships` -- those are looked up by a
 * cryptographic digest or user ID before an organization is known, exactly
 * like a login step. Every route that reads/writes them explicitly filters
 * by organization_id anyway; see src/auth/context.ts.
 */
export const TENANT_SCOPED_TABLES = [
  "agents",
  "grants",
  "policy_bundles",
  "policy_versions",
  "connectors",
  "actions",
  "idempotency_records",
  "approvals",
  "budget_windows",
  "budget_reservations",
  "execution_jobs",
  "receipts",
  "audit_events",
  "usage_events",
  "demo_runs",
] as const;
