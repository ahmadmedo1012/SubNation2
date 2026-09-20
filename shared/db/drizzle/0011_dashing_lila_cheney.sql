ALTER TABLE "auth_activity" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_activity" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inventory_variant" ON "inventory" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_forecasts_at_risk_runout" ON "inventory_forecasts" USING btree ("at_risk","predicted_runout_at") WHERE at_risk = true;--> statement-breakpoint
CREATE INDEX "idx_orders_variant" ON "orders" USING btree ("variant_id");--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "chk_enrichment_state" CHECK (state IN ('drafted','published','rejected','draft_invalid'));--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "chk_enrichment_field" CHECK (field_name IN ('description','description_long','faq'));--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "chk_enrichment_published_consistency" CHECK ((state = 'published') = (published_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "enrichment_drafts" ADD CONSTRAINT "chk_enrichment_rejected_consistency" CHECK ((state = 'rejected') = (rejected_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "inventory_forecasts" ADD CONSTRAINT "chk_forecast_confidence" CHECK (confidence IN ('high','medium','low','insufficient_data'));--> statement-breakpoint
ALTER TABLE "inventory_forecasts" ADD CONSTRAINT "chk_forecast_insufficient_consistency" CHECK ((confidence = 'insufficient_data') = (avg_daily_sales IS NULL));