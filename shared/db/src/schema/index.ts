// ── Index-ordering convention (R130-A8-F1, LANDED R134) ─────────────────────
//
// Plain `DESC` is the CANONICAL index ordering — the shape the boot twins
// (backend/src/migrate.ts V1 stages) create and the consumers' own
// `ORDER BY x DESC` wants. R134 landed the R130 follow-up: every
// divergent `.desc()` declaration (which drizzle-kit 0.31.9 serializes
// as `DESC NULLS LAST`) was rewritten as a raw `sql`col DESC``
// expression column — the emitter passes expression columns through
// VERBATIM with no NULLS suffix, so the declared shape now converges to
// the boot shape (drizzle mirror: chain 0022). On NOT NULL columns the
// two spellings are order-identical anyway; the wave's value is
// chain↔boot parity (one source of truth).
//
// ONE deliberate exception: risk.ts `idx_risk_events_created_id_desc`
// keeps `.desc()` — its boot twin (migrate.ts) is itself
// `DESC NULLS LAST`, i.e. chain == boot for that index; rewriting it
// would CREATE a divergence.
//
// Do NOT "fix" the boot twins to match any declaration — the live shape
// is the correct one.

export * from "./account-link-consents";
export * from "./admin_alerts";
export * from "./admin-sessions";
export * from "./admin_users";
export * from "./cart";
export * from "./audit_logs";
export * from "./auth_activity";
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
export * from "./push-tokens";
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
