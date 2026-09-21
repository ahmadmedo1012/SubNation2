CREATE TYPE "public"."provider_fulfillment_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "provider_fulfillments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"provider" varchar(32) DEFAULT 'manual' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "provider_fulfillment_status" NOT NULL,
	"provider_order_id" varchar(255),
	"error_code" varchar(64),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_users_referral_code";--> statement-breakpoint
DROP INDEX "idx_auth_activity_created";--> statement-breakpoint
DROP INDEX "idx_copilot_actions_admin_created";--> statement-breakpoint
DROP INDEX "idx_copilot_previews_admin_created";--> statement-breakpoint
DROP INDEX "idx_enrichment_drafts_state_created";--> statement-breakpoint
DROP INDEX "idx_enrichment_runs_started_at";--> statement-breakpoint
DROP INDEX "idx_enrichment_runs_outcome";--> statement-breakpoint
DROP INDEX "idx_inventory_sold";--> statement-breakpoint
DROP INDEX "idx_forecast_runs_started_at";--> statement-breakpoint
DROP INDEX "idx_forecast_runs_outcome";--> statement-breakpoint
DROP INDEX "idx_forecasts_product_date";--> statement-breakpoint
DROP INDEX "idx_orders_created";--> statement-breakpoint
DROP INDEX "idx_wallet_ledger_created";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "reference_type" varchar(32) DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_fulfillments" ADD CONSTRAINT "provider_fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_provider_fulfillments_order" ON "provider_fulfillments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_provider_fulfillments_provider_order" ON "provider_fulfillments" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "idx_auth_activity_created" ON "auth_activity" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_copilot_actions_admin_created" ON "copilot_actions" USING btree ("admin_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_copilot_previews_admin_created" ON "copilot_previews" USING btree ("admin_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_enrichment_drafts_state_created" ON "enrichment_drafts" USING btree ("state","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_enrichment_runs_started_at" ON "enrichment_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_enrichment_runs_outcome" ON "enrichment_runs" USING btree ("outcome","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_inventory_sold" ON "inventory" USING btree ("is_sold") WHERE is_sold = false;--> statement-breakpoint
CREATE INDEX "idx_forecast_runs_started_at" ON "inventory_forecast_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_forecast_runs_outcome" ON "inventory_forecast_runs" USING btree ("outcome","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_forecasts_product_date" ON "inventory_forecasts" USING btree ("product_id","forecast_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_orders_created" ON "orders" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_wallet_ledger_created" ON "wallet_ledger" USING btree ("created_at" DESC NULLS LAST);