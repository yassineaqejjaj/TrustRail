CREATE SCHEMA "saas_sandbox";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saas_sandbox"."account_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saas_sandbox"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"feature_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_count" integer DEFAULT 0 NOT NULL,
	"admin_user_count" integer DEFAULT 0 NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saas_sandbox"."account_actions" ADD CONSTRAINT "account_actions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "saas_sandbox"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saas_account_actions_idempotency_unique" ON "saas_sandbox"."account_actions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saas_account_actions_account_idx" ON "saas_sandbox"."account_actions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saas_accounts_org_idx" ON "saas_sandbox"."accounts" USING btree ("organization_id");