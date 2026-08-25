CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'completed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."risk_action_taken" AS ENUM('none', 'log', 'soft_block', 'hard_block', 'alert');--> statement-breakpoint
CREATE TYPE "public"."risk_event_type" AS ENUM('login_attempt', 'login_success', 'login_failure', 'otp_request', 'otp_verify', 'topup_attempt', 'topup_success', 'order_create', 'order_deliver', 'coupon_apply', 'referral_event', 'admin_force_reauth');--> statement-breakpoint
CREATE TYPE "public"."risk_label_kind" AS ENUM('confirmed_fraud', 'false_positive', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('topup', 'purchase', 'refund', 'adjustment', 'referral_credit');--> statement-breakpoint
CREATE TYPE "public"."topup_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(30) DEFAULT 'system' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(100) DEFAULT 'Admin' NOT NULL,
	"role" varchar(50) DEFAULT 'admin' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"totp_secret" varchar(255),
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_type" "audit_actor_type" DEFAULT 'system' NOT NULL,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50),
	"target_id" integer,
	"metadata" text,
	"ip" varchar(45),
	"user_agent" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"identifier" varchar(255) NOT NULL,
	"action" varchar(50) NOT NULL,
	"provider" varchar(50),
	"success" boolean NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"failure_reason" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_action_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" integer NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"failure_reason" text,
	"before_value" jsonb,
	"after_value" jsonb
);
--> statement-breakpoint
CREATE TABLE "copilot_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"preview_id" varchar(32),
	"admin_id" integer NOT NULL,
	"intent_text" text NOT NULL,
	"tool_name" varchar(100),
	"action_class" varchar(50) NOT NULL,
	"risk_tier" varchar(20) NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"failure_reason" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"confirmed_once_at" timestamp with time zone,
	"confirmed_twice_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"model_id" varchar(64),
	"model_input_tokens" integer,
	"model_output_tokens" integer,
	"correlation_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_previews" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"intent_text" text NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"action_class" varchar(50) NOT NULL,
	"risk_tier" varchar(20) NOT NULL,
	"affected_ids" jsonb NOT NULL,
	"affected_entity_type" varchar(50) NOT NULL,
	"record_versions" jsonb NOT NULL,
	"preview_payload" jsonb NOT NULL,
	"model_id" varchar(64) NOT NULL,
	"correlation_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"confirmed_once_at" timestamp with time zone,
	"cooldown_starts_at" timestamp with time zone,
	"confirmed_twice_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"type" "coupon_type" DEFAULT 'percentage' NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"min_order_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "enrichment_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"field_name" varchar(50) NOT NULL,
	"state" varchar(20) DEFAULT 'drafted' NOT NULL,
	"generated_text" text NOT NULL,
	"final_text" text,
	"model_id" varchar(64) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" integer,
	"rejected_at" timestamp with time zone,
	"rejected_by" integer,
	"rejection_reason" text,
	"validation_errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "enrichment_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" varchar(20) DEFAULT 'in_flight' NOT NULL,
	"drafts_generated" integer DEFAULT 0 NOT NULL,
	"drafts_invalid" integer DEFAULT 0 NOT NULL,
	"products_skipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tokens_spent" integer DEFAULT 0 NOT NULL,
	"daily_token_cap" integer DEFAULT 0 NOT NULL,
	"cap_reached" boolean DEFAULT false NOT NULL,
	"worker_tier" varchar(50),
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "flash_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) DEFAULT 'Flash Sale' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"account_email" varchar(255),
	"account_password" varchar(512),
	"extra_details" text,
	"is_sold" boolean DEFAULT false NOT NULL,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_forecast_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" varchar(20) DEFAULT 'in_flight' NOT NULL,
	"products_predicted" integer DEFAULT 0 NOT NULL,
	"products_skipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alerts_emitted" integer DEFAULT 0 NOT NULL,
	"alerts_capped" boolean DEFAULT false NOT NULL,
	"capture_rate_14d" numeric(4, 3),
	"worker_tier" varchar(50),
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "inventory_forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"forecast_date" date NOT NULL,
	"current_stock_on_hand" integer NOT NULL,
	"avg_daily_sales" numeric(8, 4),
	"dow_blend_7d" numeric(8, 4),
	"predicted_demand_7d" integer,
	"predicted_demand_30d" integer,
	"predicted_runout_at" date,
	"recommended_reorder_qty" integer,
	"confidence" varchar(20) NOT NULL,
	"at_risk" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" varchar(100) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_attempt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(20) DEFAULT 'system' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"link" varchar(255),
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_code" varchar(50) NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"inventory_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"wallet_balance_before" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"wallet_balance_after" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"delivered_email" varchar(255),
	"delivered_password" varchar(255),
	"delivered_extra_details" text,
	"delivered_usage_terms" text,
	"delivered_at" timestamp with time zone,
	"coupon_code" varchar(50),
	"discount_amount" numeric(10, 2) DEFAULT '0.00',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_code_unique" UNIQUE("order_code")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(160),
	"description" text,
	"description_long" text,
	"faq" jsonb,
	"image_url" varchar(1000),
	"price" numeric(10, 2) NOT NULL,
	"cost_price" numeric(10, 2),
	"category" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"usage_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" integer NOT NULL,
	"referee_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credited_at" timestamp with time zone,
	CONSTRAINT "referral_events_referee_id_unique" UNIQUE("referee_id")
);
--> statement-breakpoint
CREATE TABLE "risk_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"thresholds" jsonb DEFAULT '{"low":0,"medium":30,"high":60,"critical":85}'::jsonb NOT NULL,
	"allowlist" jsonb DEFAULT '{"ips":[],"devices":[],"phones":[]}'::jsonb NOT NULL,
	"auto_block_enabled" jsonb DEFAULT '{"softBlock":true,"hardBlock":false,"alert":true}'::jsonb NOT NULL,
	"require_approval_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" "risk_event_type" NOT NULL,
	"score" integer NOT NULL,
	"level" "risk_level" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"rule_fired" text[] DEFAULT '{}' NOT NULL,
	"statistical_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ml_score" numeric(4, 3),
	"top_features" jsonb,
	"action_taken" "risk_action_taken" DEFAULT 'log' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shown_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "risk_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"risk_event_id" integer,
	"label" "risk_label_kind" NOT NULL,
	"labeled_by" integer,
	"labeled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "risk_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"expression" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_rules_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"category" varchar(50),
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_type" varchar(10) DEFAULT 'user' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_auth_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_uid" varchar(255) NOT NULL,
	"firebase_uid" varchar(255),
	"email" varchar(255),
	"phone" varchar(20),
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"phone" varchar(20) NOT NULL,
	"google_id" varchar(255),
	"telegram_id" varchar(255),
	"firebase_uid" varchar(255),
	"email" varchar(255),
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"display_name" varchar(255),
	"photo_url" text,
	"auth_provider" varchar(50) DEFAULT 'firebase_phone' NOT NULL,
	"last_auth_at" timestamp with time zone,
	"wallet_balance" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"loyalty_tier" varchar(50) DEFAULT 'bronze' NOT NULL,
	"lifetime_spend" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"referral_code" varchar(20),
	"referred_by" integer,
	"onboarded_at" timestamp with time zone,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balance_before" numeric(10, 2) NOT NULL,
	"balance_after" numeric(10, 2) NOT NULL,
	"reference_id" integer,
	"reference_type" varchar(50),
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_topups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" varchar(50) DEFAULT 'mobile_transfer' NOT NULL,
	"payment_network" varchar(50),
	"sender_phone" varchar(20),
	"sender_account" varchar(255),
	"payment_reference" varchar(255),
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_agent" varchar(255),
	"ip_address" varchar(45),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_action_items" ADD CONSTRAINT "copilot_action_items_action_id_copilot_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."copilot_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_preview_id_copilot_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."copilot_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_previews" ADD CONSTRAINT "copilot_previews_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "enrichment_drafts_run_id_enrichment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "enrichment_drafts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "enrichment_drafts_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "enrichment_drafts_rejected_by_admin_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_forecasts" ADD CONSTRAINT "inventory_forecasts_run_id_inventory_forecast_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."inventory_forecast_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_forecasts" ADD CONSTRAINT "inventory_forecasts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_config" ADD CONSTRAINT "risk_config_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_labels" ADD CONSTRAINT "risk_labels_risk_event_id_risk_events_id_fk" FOREIGN KEY ("risk_event_id") REFERENCES "public"."risk_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_labels" ADD CONSTRAINT "risk_labels_labeled_by_admin_users_id_fk" FOREIGN KEY ("labeled_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_auth_identities" ADD CONSTRAINT "user_auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_activity_user" ON "auth_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_activity_identifier" ON "auth_activity" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_auth_activity_action" ON "auth_activity" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_auth_activity_created" ON "auth_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_copilot_action_items_action" ON "copilot_action_items" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "idx_copilot_action_items_entity" ON "copilot_action_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_copilot_actions_admin_created" ON "copilot_actions" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_copilot_actions_action_class" ON "copilot_actions" USING btree ("action_class");--> statement-breakpoint
CREATE INDEX "idx_copilot_actions_outcome" ON "copilot_actions" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "idx_copilot_actions_preview" ON "copilot_actions" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX "idx_copilot_previews_admin_created" ON "copilot_previews" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_copilot_previews_expires" ON "copilot_previews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_copilot_previews_action_class" ON "copilot_previews" USING btree ("action_class");--> statement-breakpoint
CREATE INDEX "idx_enrichment_drafts_state_created" ON "enrichment_drafts" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "idx_enrichment_drafts_product_field_state" ON "enrichment_drafts" USING btree ("product_id","field_name","state","rejected_at");--> statement-breakpoint
CREATE INDEX "idx_enrichment_drafts_run" ON "enrichment_drafts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_enrichment_runs_started_at" ON "enrichment_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_enrichment_runs_outcome" ON "enrichment_runs" USING btree ("outcome","started_at");--> statement-breakpoint
CREATE INDEX "idx_inventory_product" ON "inventory" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_sold" ON "inventory" USING btree ("is_sold");--> statement-breakpoint
CREATE INDEX "idx_inventory_product_sold" ON "inventory" USING btree ("product_id","is_sold");--> statement-breakpoint
CREATE INDEX "idx_forecast_runs_started_at" ON "inventory_forecast_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_forecast_runs_outcome" ON "inventory_forecast_runs" USING btree ("outcome","started_at");--> statement-breakpoint
CREATE INDEX "idx_forecasts_product_date" ON "inventory_forecasts" USING btree ("product_id","forecast_date");--> statement-breakpoint
CREATE INDEX "idx_forecasts_run" ON "inventory_forecasts" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forecast_product_date" ON "inventory_forecasts" USING btree ("product_id","forecast_date");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_orders_user" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_product" ON "orders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_orders_created" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_status_created" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_products_category" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_products_active" ON "products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_products_archived" ON "products" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "idx_products_active_category" ON "products" USING btree ("is_active","category");--> statement-breakpoint
CREATE INDEX "idx_referral_referrer" ON "referral_events" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "idx_risk_events_user_created" ON "risk_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_events_level_created" ON "risk_events" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_events_created" ON "risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_events_type_created" ON "risk_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_labels_event" ON "risk_labels" USING btree ("risk_event_id");--> statement-breakpoint
CREATE INDEX "idx_risk_labels_label_labeled_at" ON "risk_labels" USING btree ("label","labeled_at");--> statement-breakpoint
CREATE INDEX "idx_risk_labels_labeled_at" ON "risk_labels" USING btree ("labeled_at");--> statement-breakpoint
CREATE INDEX "idx_risk_rules_name" ON "risk_rules" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_risk_rules_enabled" ON "risk_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_tickets_user" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_replies_ticket" ON "ticket_replies" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_auth_identities_provider_uid" ON "user_auth_identities" USING btree ("provider","provider_uid");--> statement-breakpoint
CREATE INDEX "idx_user_auth_identities_user" ON "user_auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_auth_identities_firebase_uid" ON "user_auth_identities" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "idx_users_referral_code" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "idx_users_referred_by" ON "users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "idx_users_firebase_uid" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_wallet_ledger_user" ON "wallet_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wallet_ledger_type" ON "wallet_ledger" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_wallet_ledger_created" ON "wallet_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_topups_user" ON "wallet_topups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_topups_status" ON "wallet_topups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_topups_status_created" ON "wallet_topups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_otps_phone_purpose" ON "whatsapp_otps" USING btree ("phone","purpose","created_at");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_otps_expires_at" ON "whatsapp_otps" USING btree ("expires_at");