-- R123-E5 (R123-A7 P2/P3): Drizzle 0019 — the mirror re-emit of the
-- four runtime boot stages the RUNTIME boot SQL (migrate.ts) applies
-- live at the tail of every full reconcile:
--
--   V1-M27  serving-index consolidation — the three user-history
--           composites (idx_topups_user_created /
--           idx_referral_referrer_created / idx_tickets_user_created,
--           all (x_id, created_at DESC)) + the sixteen redundant twins
--           dropped (prefix-of-composite / duplicate-of-unique-backing /
--           zero-reader, R123-A7 P2);
--   V1-M28  referral_events referrer/referee FKs CASCADE → RESTRICT
--           (money-adjacent attribution; the V1-M25 boundary extended);
--   V1-M29  the eight domain CHECKs (quantity >= 1, price > 0 ×2,
--           referral status, run outcomes ×2, risk score/confidence);
--   V1-M30  organizations removal — the dead table + users.
--           organization_id + its FK (zero readers/writers, 0 live rows).
--
-- Same conventions as 0018 (R122), 0017 (R120-B6), 0016 (R118-B3) and
-- 0013 (r110): the file as emitted by `drizzle-kit generate` is
-- DECLARATIVE-ONLY — nothing in the repo executes shared/db/drizzle/*.sql
-- at runtime (prod schema flows exclusively through migrate.ts), and CI
-- only regenerates + diffs. The statements below are hand-hardened
-- (r110 idiom) so the chain is ALSO safe the day it IS applied (manual
-- `drizzle-kit migrate`, a chain-built fresh environment, or a future
-- wiring):
--
--   - every DROP INDEX / DROP CONSTRAINT / DROP COLUMN / DROP TABLE
--     carries IF EXISTS: on the runtime shape the objects are already
--     gone (V1-M27..M30 applied them live), so every drop no-ops;
--   - the referral FK drops cover BOTH worlds (the drizzle chain name
--     AND the boot name fk_referral_referrer / fk_referral_referee);
--   - every ADD CONSTRAINT is wrapped in the migrate.ts
--     duplicate_object-swallowing DO block (V1-M9/V1-M10 idiom), and
--     the referral FK ADDs use the BOOT names — the live DB carries
--     them (created by the migrate.ts fkStatements loop), mirroring the
--     objects the runtime boot SQL has already applied live;
--   - every CREATE INDEX carries IF NOT EXISTS (the boot twins created
--     them live under the same names);
--   - the generated `ALTER TABLE organizations DISABLE ROW LEVEL
--     SECURITY` was removed: on the runtime shape the table is already
--     dropped and that bare ALTER would 42P01 — a nothing-statement
--     (RLS was never enabled) is not worth a guard.
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "referral_events_referrer_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "fk_referral_referrer";--> statement-breakpoint
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "referral_events_referee_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "fk_referral_referee";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_organization_id_organizations_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_cart_items_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_idempotency_keys_order";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_forecasts_product_date";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_orders_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_orders_status";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_points_ledger_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_products_active";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_products_archived";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_product_variants_product";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_referral_referrer";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_risk_events_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_risk_rules_name";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tickets_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_wallet_ledger_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_topups_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_topups_status";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "referral_events" ADD CONSTRAINT "fk_referral_referrer" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "referral_events" ADD CONSTRAINT "fk_referral_referee" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_referrer_created" ON "referral_events" USING btree ("referrer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_user_created" ON "support_tickets" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_topups_user_created" ON "wallet_topups" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "organization_id";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cart_items" ADD CONSTRAINT "chk_cart_items_quantity_pos" CHECK (quantity >= 1);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrichment_runs" ADD CONSTRAINT "chk_enrichment_runs_outcome" CHECK (outcome IN ('in_flight','success','failure'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_forecast_runs" ADD CONSTRAINT "chk_forecast_runs_outcome" CHECK (outcome IN ('in_flight','success','failure'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "chk_products_price_pos" CHECK (price > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "product_variants" ADD CONSTRAINT "chk_variant_price_pos" CHECK (price_lyd > 0 AND cost_price >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "referral_events" ADD CONSTRAINT "chk_referral_status" CHECK (status IN ('pending','credited'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "risk_events" ADD CONSTRAINT "chk_risk_score_range" CHECK (score >= 0 AND score <= 100);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "risk_events" ADD CONSTRAINT "chk_risk_confidence_range" CHECK (confidence >= 0 AND confidence <= 1);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "organizations" CASCADE;
