-- R135 (DB-1): Drizzle 0023 — the mirror of boot stage V1-M34
-- (migrate.ts applyR135IndexWaveStage): the R135 serving-index wave —
-- the couponWatcher expiry-scan partial (idx_coupons_expires_at,
-- additive — jobs/couponWatcher.ts filters expires_at IS NOT NULL on
-- BOTH arms) + the two user-history keyset swaps
-- (idx_wallet_ledger_user_created / idx_orders_user_created →
-- (user_id, created_at DESC, id DESC): the wallet statement ORDER BY
-- created_at DESC, id DESC tail (routes/wallet.ts) and the user orders
-- list (routes/orders.ts) — the idx_risk_events_created_id_desc house
-- shape for that ORDER BY family).
--
-- Same conventions as 0013/0016/0017/0018/0019/0020/0021/0022 (r110
-- idiom): the file as emitted by `drizzle-kit generate` is
-- DECLARATIVE-ONLY — nothing in the repo executes it at runtime (prod
-- schema flows exclusively through migrate.ts: V1-M34 converges the two
-- swaps probe-gated at boot, the base round-4 block creates the new
-- shapes on fresh installs), and CI only regenerates + diffs. The
-- statements below are hand-hardened so the chain is ALSO safe the day
-- it IS applied (manual `drizzle-kit migrate`, a chain-built fresh
-- environment, or a future wiring):
--
--   - every DROP INDEX carries IF EXISTS (0013/0017 idiom): on the
--     runtime shape the boot twin has already converged both names to
--     the keyset shape, so the drops no-op; on a chain-built database
--     the 0005-era (user_id, created_at) twins are the ones present and
--     must be dropped for the swap;
--   - every CREATE INDEX carries IF NOT EXISTS (V1-M21/B8-10 idiom) —
--     on the runtime shape both swapped objects and the additive
--     partial already exist under these exact names;
--   - the sort columns are raw expression columns (sql`col DESC`) per
--     the R134-A8-F1 convention — plain DESC, byte-matching the boot
--     twins (a .desc() declaration would serialize as DESC NULLS LAST
--     and re-create the divergence the 0022 wave closed).
DROP INDEX IF EXISTS "idx_orders_user_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_wallet_ledger_user_created";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coupons_expires_at" ON "coupons" USING btree ("expires_at") WHERE expires_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_user_created" ON "orders" USING btree ("user_id",created_at DESC,id DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_ledger_user_created" ON "wallet_ledger" USING btree ("user_id",created_at DESC,id DESC);