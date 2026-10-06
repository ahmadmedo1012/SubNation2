-- R118-B3 (A3 F2/F3 + A6 F-4): Drizzle 0016 — the mirror re-emit of the
-- objects the RUNTIME boot SQL (migrate.ts) has already applied live.
--
-- Like 0013 (r110): the file as emitted by `drizzle-kit generate` is
-- DECLARATIVE-ONLY — nothing in the repo executes shared/db/drizzle/*.sql
-- at runtime (prod schema flows exclusively through migrate.ts: V1-M9/M10
-- applied the users/coupons/topups/ledger CHECKs, V1-M21 the points_ledger
-- guards + partial UNIQUE index, V1-M22 the orders refund range), and CI
-- only regenerates + diffs. The statements below are the r110 hardening so
-- the chain is ALSO safe the day it IS applied (manual `drizzle-kit
-- migrate`, a chain-built fresh environment, or a future wiring):
--
--   - every ADD CONSTRAINT is wrapped in the migrate.ts duplicate_object-
--     swallowing DO block (V1-M9/V1-M10 idiom) — on the live shape all ten
--     already exist under these exact names and would raise 42710;
--   - every CREATE [UNIQUE] INDEX carries IF NOT EXISTS (V1-M21/B8-10
--     idiom) — idx_admin_alerts_created is the one genuinely additive
--     object (live admin_alerts has only pkey + dedupe index); the points
--     exactly-once index is re-declared UNIQUE (F2: it was wrongly mirrored
--     as non-unique since 0014 — live has been UNIQUE since V1-M21);
--   - the DROP INDEX carries IF EXISTS (0013 idiom): on a chain-built
--     database the 0014-era twin is NON-unique and must be dropped for the
--     conversion; on the runtime shape it drops + re-creates the identical
--     UNIQUE object (verified live-clean: zero duplicate (type,
--     reference_id) pairs, R118-A3).
--
-- uniq_product_variants_plan_duration (NULLS NOT DISTINCT) is NOT touched:
-- drizzle-orm 0.45.2 cannot express nullsNotDistinct() on uniqueIndex(),
-- so V1-M17 stays the authoritative DDL for that object (see the mirror
-- comment in product-variants.ts and BOOT_OWNED_OBJECTS in
-- backend/src/jobs/__tests__/migrate-drizzle-0016.test.ts).
DROP INDEX IF EXISTS "uniq_points_ledger_type_reference";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_alerts_created" ON "admin_alerts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_points_ledger_type_reference" ON "points_ledger" USING btree ("type","reference_id") WHERE reference_id IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coupons" ADD CONSTRAINT "chk_coupons_used_le_max" CHECK (max_uses IS NULL OR used_count <= max_uses);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_refund_amount_range" CHECK (refund_amount IS NULL OR (refund_amount > 0 AND refund_amount <= amount));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "points_ledger" ADD CONSTRAINT "chk_points_ledger_arithmetic" CHECK (points_after = points_before + points_delta);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "points_ledger" ADD CONSTRAINT "chk_points_ledger_delta_nonzero" CHECK (points_delta <> 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "points_ledger" ADD CONSTRAINT "chk_points_ledger_balances_nonneg" CHECK (points_before >= 0 AND points_after >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "points_ledger" ADD CONSTRAINT "chk_points_ledger_reason_for_manual" CHECK (type NOT IN ('admin_set', 'correction') OR reason IS NOT NULL);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "chk_users_wallet_balance_nonneg" CHECK (wallet_balance >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "chk_users_loyalty_points_nonneg" CHECK (loyalty_points >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_ledger" ADD CONSTRAINT "chk_ledger_amount_nonzero" CHECK (amount <> 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_topups" ADD CONSTRAINT "chk_topups_amount_pos" CHECK (amount > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
