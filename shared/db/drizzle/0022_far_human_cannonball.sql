-- R134 (A8-F1 + A8-F2): Drizzle 0022 — the DESC-index regen wave + the
-- zero-consumer wallet_ledger.type index removal.
--
-- The 18 same-name DROP+CREATE pairs converge the DECLARED shape to the
-- boot twins' plain DESC (the R130-A8-F1 divergence close-out: drizzle-kit
-- 0.31.9 serialized .desc() as DESC NULLS LAST while migrate.ts creates
-- plain DESC — the shape the consumers' ORDER BY x DESC wants; on NOT NULL
-- columns the two are order-identical, so this is chain<->boot PARITY, not
-- a live perf change). risk.ts idx_risk_events_created_id_desc is the one
-- deliberate exception (its boot twin is NULLS LAST too — rewriting it
-- would CREATE a divergence).
--
-- idx_wallet_ledger_type (A8-F2) is DROPPED ONLY: zero predicate consumers
-- (grep-verified R130, re-verified R134) — pure write amplification on the
-- money ledger INSERT table. Boot twin: V1-M33
-- applyWalletLedgerTypeIndexDropStage (probe-gated, same round).
--
-- Same conventions as 0013/0016/0017/0021 (r110 idiom): DECLARATIVE-ONLY —
-- nothing in the repo executes this file at runtime; CI only regenerates +
-- diffs. Hand-hardened so the chain is ALSO safe the day it IS applied: on
-- the runtime shape every index already exists under these exact names, so
-- each IF EXISTS + IF NOT EXISTS pair rebuilds each index once (sub-ms at
-- current rowcounts, the V1-M31 NOT-CONCURRENTLY decision class) and
-- no-ops thereafter; on a chain-built fresh environment the file simply
-- creates the canonical shapes.
DROP INDEX IF EXISTS "idx_wallet_ledger_type";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_admin_alerts_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_admin_alerts_unread";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_audit_logs_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_auth_activity_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_copilot_actions_admin_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_copilot_previews_admin_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_enrichment_drafts_state_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_enrichment_runs_started_at";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_enrichment_runs_outcome";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_forecast_runs_started_at";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_forecast_runs_outcome";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_notifications_user";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_orders_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_referral_referrer_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tickets_user_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tickets_status_updated";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_wallet_ledger_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_topups_user_created";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_alerts_created" ON "admin_alerts" USING btree (created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_alerts_unread" ON "admin_alerts" USING btree (created_at DESC) WHERE is_read = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs" USING btree (created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_activity_created" ON "auth_activity" USING btree (created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_copilot_actions_admin_created" ON "copilot_actions" USING btree ("admin_id",created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_copilot_previews_admin_created" ON "copilot_previews" USING btree ("admin_id",created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enrichment_drafts_state_created" ON "enrichment_drafts" USING btree ("state",created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enrichment_runs_started_at" ON "enrichment_runs" USING btree (started_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enrichment_runs_outcome" ON "enrichment_runs" USING btree ("outcome",started_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_forecast_runs_started_at" ON "inventory_forecast_runs" USING btree (started_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_forecast_runs_outcome" ON "inventory_forecast_runs" USING btree ("outcome",started_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "notifications" USING btree ("user_id",created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_created" ON "orders" USING btree (created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_referrer_created" ON "referral_events" USING btree ("referrer_id",created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_user_created" ON "support_tickets" USING btree ("user_id",created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_status_updated" ON "support_tickets" USING btree ("status",updated_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_ledger_created" ON "wallet_ledger" USING btree (created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_topups_user_created" ON "wallet_topups" USING btree ("user_id",created_at DESC);