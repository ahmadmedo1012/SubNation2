import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

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
 * The row is written INSIDE the checkout transaction, immediately
 * after the order + ledger inserts. FK `ON DELETE CASCADE` follows the
 * order's lifecycle: if the buyer's account is deleted (cascade
 * removes the order), the key row goes with it — the dedup never
 * outlives the money it guards.
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
    /** The order this key created — claimed atomically in its tx. */
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("idx_idempotency_keys_order").on(t.orderId),
  }),
);
