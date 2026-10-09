import { index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Durable idempotency for the customer money path (F10, round-94 A4).
 *
 * The HTTP-layer middleware (middlewares/idempotency.ts) dedupes via
 * Redis with a 24h TTL and only for clients that send the
 * `Idempotency-Key` header — a cache flush, a Redis outage, or any
 * non-UI client bypasses it entirely. This table is the durable,
 * transactional backstop: the purchase transaction claims the key
 * atomically with the order itself (same commit / same rollback), so
 * a retry with the same key can NEVER create a second order or a
 * second wallet debit, regardless of Redis state or client shape.
 *
 * Scope: `key` is stored ALREADY SCOPED per user by the service layer
 * (`u{userId}:{clientKey}`) — two different buyers reusing the same
 * client key string can never collide (mirrors the middleware's
 * subject-scoped Redis keys).
 *
 * R102 (loyalty durable guard): `order_id` is now NULLABLE and a
 * `reference_type` discriminator was added (default 'order'). The
 * checkout path is unchanged; the loyalty convert-points path claims
 * the same table with (order_id NULL, reference_type 'loyalty.convert')
 * — its 23505 maps to a 409 "already converted" instead of a replay
 * (the conversion result is reconstructible from the user's balance;
 * replaying a payload was unnecessary complexity).
 *
 * R108 (final-hardening FH-A7 P0): `order_id` is now a POLYMORPHIC
 * reference discriminated by `reference_type` ('order' /
 * 'topup.create' / 'loyalty.convert' / 'admin.adjustment') — the wallet
 * topup-create path claims it with a `wallet_topups.id`, which the
 * V1-M12-era FK to `orders(id)` forbids (SQLSTATE 23503 → the whole
 * submission tx rolls back → topup 500s on the first live run).
 * V1-M20 DROPS that FK: referential integrity for the polymorphic
 * column is app-owned (each intent's claim site knows its own id
 * space), the same contract the loyalty path already used for NULL.
 * The drizzle declaration therefore declares NO .references() —
 * introspection/push must not re-create the constraint.
 *
 * Registration note (round-94 C4, updated round-98 F4): this module IS
 * re-exported from schema/index.ts (line 15 of the barrel) and the table
 * is created by migration V1-M12 (both landed with the round-94 DB fix).
 * Consumers may import it from the barrel or directly — both resolve to
 * the same pgTable object. The service tolerates the table's absence
 * (SQLSTATE 42P01 → legacy pass-through behavior) so deploys never
 * depend on migration ordering.
 */
export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    /** User-scoped key: `u{userId}:{clientKey}` (see module docs). */
    key: text("key").primaryKey(),
    /**
     * Polymorphic reference (R102 nullable, R108 FK-free): the id of the
     * row the key guards, interpreted by `reference_type` — orders.id for
     * 'order', wallet_topups.id for 'topup.create', NULL for intents whose
     * result is reconstructible (loyalty). App-owned integrity (module docs).
     */
    orderId: integer("order_id"),
    /** R102: what the key guards — 'order' (default) or 'loyalty.convert'. */
    referenceType: varchar("reference_type", { length: 32 }).notNull().default("order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // R123-E5 (V1-M27): idx_idempotency_keys_order dropped — ZERO readers
  // (grep-verified: reference lookups go through the key PK; the column
  // is a polymorphic reference whose integrity is app-owned since
  // V1-M20). Pure write amplification on the checkout claim path; boot
  // twin: migrate.ts applyIndexConsolidationStage (probe-gated DROP
  // INDEX IF EXISTS).
  (t) => ({
    // R127-L3 (B7 P2-1 / B8 G4): idempotency-retention's
    // `created_at < 48h` prune (jobs/idempotency-retention.ts, daily
    // 00:00 + boot one-shot) — the table's only index WAS the
    // order-column twin above until V1-M27 dropped it, so every prune
    // batch was a seq scan on the money path's hottest INSERT table.
    // Boot twin: migrate.ts applyRetentionPruneIndexesStage (V1-M31);
    // drizzle mirror: 0020.
    createdIdx: index("idx_idempotency_keys_created").on(t.createdAt),
  }),
);
