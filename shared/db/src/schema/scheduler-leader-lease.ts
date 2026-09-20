import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * PostgreSQL-backed leader lease for the scheduler layer (97-F1).
 *
 * `scheduler_leader_lease` is the single-row table backing
 * backend/src/lib/pg-leader-lease.ts — the lock backend the scheduler
 * coordinator falls back to when no Redis client exists (the round-97
 * REDIS_URL outage left every cron/watcher dead while the app kept
 * serving; see docs/inspection-r97/backend-services-infra.md).
 *
 * Semantics (mirroring Redis `SET NX EX`):
 *   - exactly ONE row (id = 1, enforced by CHECK + DEFAULT 1);
 *   - holder identifies the winning instance;
 *   - expires_at bounds leadership — an expired lease can be taken over
 *     in one CAS statement (`INSERT .. ON CONFLICT (id) DO UPDATE ..
 *     WHERE expires_at <= now() OR holder = EXCLUDED.holder RETURNING`).
 *
 * The table is created lazily + idempotently at first use by
 * pg-leader-lease.ts (deploy-order-proof) and is registered canonically
 * by migration V1-M14 (backend/src/migrate.ts,
 * applySchedulerLeaseAndConsentTablesStage) with this exact shape —
 * column names/types are pinned VERBATIM between the two sources.
 */
export const schedulerLeaderLeaseTable = pgTable(
  "scheduler_leader_lease",
  {
    /** Always 1 — the single-row invariant (CHECK + DEFAULT mirror the lazy DDL). */
    id: integer("id").primaryKey().default(1),
    /** Identity of the current leader (host+pid — never a secret). */
    holder: text("holder").notNull(),
    /** Lease expiry; comparisons run on the DB clock (now()) to ignore skew. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  () => ({
    // Mirrors the lazy DDL's inline `CHECK (id = 1)` (Postgres auto-names
    // an inline check on `id` exactly this way).
    singleRow: check("scheduler_leader_lease_id_check", sql`id = 1`),
  }),
);
