-- R122 (A4-P1-2 + A4-P2-5): Drizzle 0018 — the mirror re-emit of the
-- money-history user-FK RESTRICT conversion (V1-M25) and the two money
-- CHECKs (V1-M26) the RUNTIME boot SQL (migrate.ts) applies live.
--
-- Same conventions as 0017 (R120-B6), 0016 (R118-B3) and 0013 (r110): the
-- file as emitted by `drizzle-kit generate` is DECLARATIVE-ONLY — nothing
-- in the repo executes shared/db/drizzle/*.sql at runtime (prod schema
-- flows exclusively through migrate.ts: V1-M25 rebuilds the four user FKs
-- as ON DELETE RESTRICT after an orphan probe, V1-M26 adds the two CHECKs
-- after violation probes), and CI only regenerates + diffs. The statements
-- below are hand-hardened (r110 idiom) so the chain is ALSO safe the day
-- it IS applied (manual `drizzle-kit migrate`, a chain-built fresh
-- environment, or a future wiring):
--
--   - every DROP CONSTRAINT carries IF EXISTS: on the runtime shape the
--     boot-named twin (fk_orders_user / fk_wallet_ledger_user /
--     fk_topups_user / points_ledger_user_id_fkey — the LIVE names,
--     deliberately NOT the drizzle-chain names; see the P1-1 documented
--     divergence) is the one present, so the drizzle-named drop no-ops;
--     on a chain-built database the 0000-era drizzle-named CASCADE twin
--     is the one present, so both drops converge either world to exactly
--     one FK before the ADD;
--   - every ADD CONSTRAINT is wrapped in the migrate.ts duplicate_object-
--     swallowing DO block (V1-M9/V1-M10 idiom) — on the live shape all
--     six objects already exist under these exact names;
--   - the FK ADDs use the BOOT names: the live DB carries them (created
--     by the migrate.ts fkStatements loop / V1-M9 / the V1-M21 CREATE
--     TABLE auto-name), and 0016's own header pins the chain's purpose —
--     mirror the objects the runtime boot SQL has already applied live.
--     ON DELETE RESTRICT is the R122 never-delete audit-trail policy
--     (the only supported "deletion" story is user anonymization).
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk_orders_user";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "points_ledger" DROP CONSTRAINT IF EXISTS "points_ledger_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "points_ledger" DROP CONSTRAINT IF EXISTS "points_ledger_user_id_fkey";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "wallet_ledger" DROP CONSTRAINT IF EXISTS "wallet_ledger_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "wallet_ledger" DROP CONSTRAINT IF EXISTS "fk_wallet_ledger_user";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_ledger" ADD CONSTRAINT "fk_wallet_ledger_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "wallet_topups" DROP CONSTRAINT IF EXISTS "wallet_topups_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "wallet_topups" DROP CONSTRAINT IF EXISTS "fk_topups_user";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_topups" ADD CONSTRAINT "fk_topups_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_amount_pos" CHECK (amount > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_ledger" ADD CONSTRAINT "chk_ledger_arithmetic" CHECK ((type <> 'purchase' AND balance_after = balance_before + amount) OR (type = 'purchase' AND balance_after = balance_before - amount));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
