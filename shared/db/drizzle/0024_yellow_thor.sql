-- R143 (L9-1): cosmetic index re-shape with net-zero effect. 0003's
-- original `USING btree (true)` was a 42601 syntax error on real
-- Postgres (constant index_elem must be parenthesized) — hand-fixed to
-- `((true))` and the schema TS expression form updated to match, which
-- drizzle-kit surfaces as this drop+recreate pair. Nothing executes the
-- chain at runtime (migrate.ts is the runtime owner and already spells
-- the index `((true))`); a fresh chain replay now applies cleanly.
DROP INDEX "uniq_flash_sales_active_singleton";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_flash_sales_active_singleton" ON "flash_sales" USING btree ((true)) WHERE is_active = true;
