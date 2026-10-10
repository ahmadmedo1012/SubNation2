// ── Index-ordering convention (R130-A8-F1) ──────────────────────────────────
//
// The `.desc()` index columns below are DECLARED as `DESC NULLS LAST`
// (what drizzle-kit 0.45 generates), but the LIVE indexes were created by
// the boot twins (backend/src/migrate.ts V1 stages) as plain `DESC` —
// which in Postgres means NULLS FIRST, the shape the consumers' own
// `ORDER BY x DESC` (drizzle emits plain desc) wants. The `IF NOT EXISTS`
// name-parity idiom makes the two tracks no-op against each other, so
// nothing diverges at runtime today; the divergence is real only for a
// CHAIN-built fresh environment, where the declared shape can be a hair
// less optimal for its own ORDER BY.
//
// Until the follow-up re-declaration lands (rewrite each `.desc()` as a
// raw sql`col desc` expression column so drizzle-kit emits the boot shape,
// then regen the chain + snapshot), treat plain `DESC` as the canonical
// index ordering and do NOT "fix" the boot twins to match the chain —
// the live shape is the correct one.

export * from "./account-link-consents";
export * from "./admin_alerts";
export * from "./admin-sessions";
export * from "./admin_users";
export * from "./cart";
export * from "./audit_logs";
export * from "./auth_activity";
export * from "./copilot_action_items";
export * from "./copilot_actions";
export * from "./copilot_previews";
export * from "./coupons";
export * from "./enrichment_drafts";
export * from "./enrichment_runs";
export * from "./flash_sales";
export * from "./idempotency-keys";
export * from "./inventory";
export * from "./inventory_forecast_runs";
export * from "./inventory_forecasts";
export * from "./login_attempts";
export * from "./notifications";
export * from "./orders";
export * from "./points_ledger";
export * from "./products";
export * from "./product-variants";
export * from "./provider-fulfillments";
export * from "./referral_events";
export * from "./risk";
export * from "./scheduler-leader-lease";
export * from "./support_tickets";
export * from "./ticket_replies";
export * from "./user_auth_identities";
export * from "./users";
export * from "./wallet_ledger";
export * from "./wallet_topups";
export * from "./sessions";
export * from "./whatsapp_otps";
export * from "./system_settings";
export * from "./openwa_sessions";
