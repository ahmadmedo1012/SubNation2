CREATE TABLE "system_settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openwa_sessions" (
	"name" text PRIMARY KEY NOT NULL,
	"creds" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uniq_cart_items_user_product";--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" USING btree ("actor_id","actor_type");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_target" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_flash_sales_active_singleton" ON "flash_sales" USING btree (true) WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_login_attempts_identifier" ON "login_attempts" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_cart_items_user_product" ON "cart_items" USING btree ("user_id","product_id");