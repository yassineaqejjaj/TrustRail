CREATE SCHEMA "merchant_sandbox";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_sandbox"."orders" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_ref" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"original_payment_destination" text NOT NULL,
	"disputed" boolean DEFAULT false NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_sandbox"."refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"destination" text NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_sandbox"."refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "merchant_sandbox"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_orders_org_idx" ON "merchant_sandbox"."orders" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_refunds_idempotency_unique" ON "merchant_sandbox"."refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_refunds_order_idx" ON "merchant_sandbox"."refunds" USING btree ("order_id");