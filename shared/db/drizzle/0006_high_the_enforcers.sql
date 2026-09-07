ALTER TABLE "admin_alerts" ADD COLUMN "dedupe_key" varchar(100);--> statement-breakpoint
CREATE INDEX "idx_admin_alerts_dedupe_key" ON "admin_alerts" USING btree ("dedupe_key","created_at");