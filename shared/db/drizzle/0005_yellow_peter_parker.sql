CREATE INDEX "idx_orders_user_created" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_events_created_id_desc" ON "risk_events" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_users_created" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_wallet_ledger_user_created" ON "wallet_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
-- Round-3 (8-c §4.2): admin user search uses LIKE '%x%' on phone —
-- btree can't serve leading-wildcard patterns. pg_trgm + GIN, the exact
-- pattern 0003 applied to products.name.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "idx_users_phone_trgm" ON "users" USING gin ("phone" gin_trgm_ops);
