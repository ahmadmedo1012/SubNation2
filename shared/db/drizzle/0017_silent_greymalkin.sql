-- R120-B6 (A6 F3/F4): Drizzle 0017 — the mirror re-emit of the two
-- user/admin list read-path indexes the RUNTIME boot SQL (migrate.ts)
-- applies live.
--
-- Same conventions as 0016 (R118-B3) and 0013 (r110): the file as emitted
-- by `drizzle-kit generate` is DECLARATIVE-ONLY — nothing in the repo
-- executes shared/db/drizzle/*.sql at runtime (prod schema flows
-- exclusively through migrate.ts), and CI only regenerates + diffs. The
-- statements below are hand-hardened (r110 idiom) so the chain is ALSO
-- safe the day it IS applied (manual `drizzle-kit migrate`, a chain-built
-- fresh environment, or a future wiring):
--
--   - every CREATE INDEX carries IF NOT EXISTS (V1-M21/B8-10 idiom) — on
--     the runtime shape the boot twin (V1-M24 stage + the base missing-
--     indexes block) has already created both objects under these exact
--     names;
--   - the DROP INDEX carries IF EXISTS (0013 idiom): on a chain-built
--     database the 0000-era twin is the (user_id, is_read) shape and must
--     be dropped for the (user_id, created_at DESC) swap; on the runtime
--     shape the V1-M24 probe-gated swap has already converged it, so the
--     drop+create pair rebuilds the identical object once and no-ops
--     thereafter.
DROP INDEX IF EXISTS "idx_notifications_user";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_status_updated" ON "support_tickets" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);
