CREATE TABLE IF NOT EXISTS "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment" text NOT NULL,
	"actor_agent_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"root_grant_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"decision" text NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_state" text NOT NULL,
	"policy_version_id" text,
	"policy_hash" text,
	"approval_id" text,
	"connector_reference" text,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"environment" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_digest" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_user_id" text NOT NULL,
	"environment" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"action_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"principal_id" text NOT NULL,
	"grant_chain_ids" jsonb NOT NULL,
	"policy_version_id" text NOT NULL,
	"policy_hash" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"triggering_rule" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" text,
	"reviewer_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"event" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"budget_window_id" text NOT NULL,
	"action_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"window_date" text NOT NULL,
	"currency" text NOT NULL,
	"limit_minor" integer NOT NULL,
	"reserved_minor" integer DEFAULT 0 NOT NULL,
	"committed_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "demo_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scenario_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"action_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grants" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment" text NOT NULL,
	"principal_id" text NOT NULL,
	"issuer_type" text NOT NULL,
	"issuer_id" text NOT NULL,
	"subject_agent_id" text NOT NULL,
	"parent_grant_id" text,
	"root_grant_id" text NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"allowed_resource_ids" jsonb NOT NULL,
	"unrestricted_resources" boolean DEFAULT false NOT NULL,
	"allowed_connector_ids" jsonb NOT NULL,
	"currency" text NOT NULL,
	"max_amount_minor" integer NOT NULL,
	"root_budget_limit_minor" integer,
	"child_budget_limit_minor" integer,
	"valid_from" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"delegation_allowed" boolean DEFAULT false NOT NULL,
	"max_remaining_depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_agent_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"action_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"environment_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"app_mode" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"environment" text NOT NULL,
	"action" text NOT NULL,
	"active_version_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_bundle_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"bundle" jsonb NOT NULL,
	"bundle_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"change_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"action_id" text NOT NULL,
	"receipt_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"jws" text NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signing_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"public_key_jwk" jsonb NOT NULL,
	"private_key_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "signing_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event_type" text NOT NULL,
	"action_id" text,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "actions" ADD CONSTRAINT "actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "actions" ADD CONSTRAINT "actions_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_budget_window_id_budget_windows_id_fk" FOREIGN KEY ("budget_window_id") REFERENCES "public"."budget_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_windows" ADD CONSTRAINT "budget_windows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connectors" ADD CONSTRAINT "connectors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demo_runs" ADD CONSTRAINT "demo_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_subject_agent_id_agents_id_fk" FOREIGN KEY ("subject_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_bundles" ADD CONSTRAINT "policy_bundles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_bundle_id_policy_bundles_id_fk" FOREIGN KEY ("policy_bundle_id") REFERENCES "public"."policy_bundles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_org_idx" ON "actions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_org_created_idx" ON "actions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_status_idx" ON "actions" USING btree ("organization_id","execution_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_credentials_org_idx" ON "agent_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_credentials_agent_idx" ON "agent_credentials" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_credentials_prefix_idx" ON "agent_credentials" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_org_idx" ON "agents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_org_idx" ON "approvals" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvals_action_unique" ON "approvals" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_pending_expiry_idx" ON "approvals" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_org_idx" ON "audit_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_reservations_window_idx" ON "budget_reservations" USING btree ("budget_window_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_reservations_action_idx" ON "budget_reservations" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_windows_org_grant_date_unique" ON "budget_windows" USING btree ("organization_id","grant_id","window_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_windows_org_date_idx" ON "budget_windows" USING btree ("organization_id","window_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connectors_org_idx" ON "connectors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_runs_org_idx" ON "demo_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_jobs_org_idx" ON "execution_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_jobs_claim_idx" ON "execution_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_action_unique" ON "execution_jobs" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_org_idx" ON "grants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_parent_idx" ON "grants" USING btree ("parent_grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_root_idx" ON "grants" USING btree ("root_grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_subject_idx" ON "grants" USING btree ("subject_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_scope_unique" ON "idempotency_records" USING btree ("organization_id","actor_agent_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_org_user_unique" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "policy_bundles_org_env_action_unique" ON "policy_bundles" USING btree ("organization_id","environment","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_versions_org_idx" ON "policy_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "policy_versions_bundle_version_unique" ON "policy_versions" USING btree ("policy_bundle_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_org_idx" ON "receipts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_action_idx" ON "receipts" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_digest_idx" ON "sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_org_idx" ON "usage_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_org_created_idx" ON "usage_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree (lower("email"));