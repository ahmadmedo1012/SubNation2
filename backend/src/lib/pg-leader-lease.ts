/**
 * PostgreSQL-backed leader lease for the scheduler layer (97-F1).
 *
 * Round-97 context: REDIS_URL went missing from the Render environment and
 * the Redis service was never provisioned, so `getRedisClient()` resolved
 * to `null` FOREVER (no client object is ever created — the acquisition
 * retry loop cannot out-wait a missing env var). The coordinator's F2
 * fail-closed policy then left every cron / watcher / alerting evaluator
 * dead for the whole process lifetime while the app kept serving traffic
 * and passing health checks (silent outage of 2026-09-08..11, see
 * docs/inspection-r97/backend-services-infra.md).
 *
 * Postgres is already the money-path dependency in EVERY environment (the
 * migrations run fail-open against it at every boot), so this module gives
 * the coordinator a leader lock with the SAME semantics as the Redis
 * `SET NX EX` lock, backed by a single-row table:
 *
 *   - acquire(holder, ttlSec) — one INSERT .. ON CONFLICT (id) DO UPDATE
 *     .. WHERE <expired OR same holder> RETURNING holder statement. Covers
 *     first-acquire (conflict-free insert), take-over-after-expiry, and
 *     idempotent re-acquire by the SAME holder (the renewal path a demoted
 *     instance uses to win the lease back without waiting for expiry).
 *     No row (or a foreign holder) → busy.
 *   - refresh(holder, ttlSec) — renews ONLY if we still hold an UNEXPIRED
 *     lease (holder verified in the WHERE clause). No row → lost: another
 *     instance may have taken over after our expiry — callers must demote.
 *   - release(holder) — deletes only OUR row.
 *
 * All three statements are single-round-trip (safe through the Neon
 * transaction pooler — no multi-statement strings, no session state).
 * Expiry comparisons all run on the database clock (`now()`), so instance
 * clock skew cannot split leadership.
 *
 * The table is created lazily + idempotently on first use (memoized per
 * process; a failed bootstrap resets the memo so the next op retries).
 * F7 (round-97) later registers the table in migrate.ts officially — the
 * CREATE IF NOT EXISTS here keeps the lease self-sufficient either way.
 *
 * Error contract: NOTHING in this module ever throws across a scheduler
 * boundary — every op maps failures to the "error" outcome (the
 * coordinator's retry loop keeps re-attempting; the 60 s TTL is the
 * backstop), logging through the shared logger (category "monitoring").
 */

import { logger } from "./logger";

// ── Outcomes (mirroring the coordinator's Redis lock vocabulary) ────────────

/** Acquire: won the lease / another holder has it / evaluation failed. */
export type SchedulerLeaseAcquireOutcome = "acquired" | "busy" | "error";
/** Refresh: still the verified holder / lost (or never held) / failed. */
export type SchedulerLeaseRefreshOutcome = "renewed" | "lost" | "error";
/** Release: our row deleted / we were not the holder / failed. */
export type SchedulerLeaseReleaseOutcome = "released" | "not-held" | "error";

/**
 * The lock backend the scheduler coordinator drives when Redis is
 * unavailable. Structurally identical to the Redis code path's
 * acquire / refresh / release trio so the coordinator's state machine
 * (retry loop, TTL refresher, demotion, release) stays unchanged.
 */
export interface SchedulerLeaderLeaseBackend {
  acquire(holder: string, ttlSec: number): Promise<SchedulerLeaseAcquireOutcome>;
  refresh(holder: string, ttlSec: number): Promise<SchedulerLeaseRefreshOutcome>;
  release(holder: string): Promise<SchedulerLeaseReleaseOutcome>;
}

// ── Shared pool access ──────────────────────────────────────────────────────

/**
 * Minimal structural pool surface the lease needs. Structural (NOT
 * `pg.Pool`) so the test seam can inject a plain object, and so backend
 * code never grows a direct `pg` dependency (pg belongs to @workspace/db).
 * The REAL pool from @workspace/db is assignable to this shape.
 */
export interface PgLeaderLeasePool {
  query(text: string, values?: ReadonlyArray<unknown>): Promise<PgLeaderLeaseQueryResult>;
}

interface PgLeaderLeaseQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

/** Test seam — mock pool boundary. `null` restores the shared-pool default. */
let injectedPool: PgLeaderLeasePool | null = null;

/**
 * Test seam: swap the pool the lease statements run against. Also resets the
 * CREATE TABLE memo — a different pool is a different database.
 */
export function __setPgLeaderLeasePoolForTests(pool: PgLeaderLeasePool | null): void {
  injectedPool = pool;
  tableReady = null;
}

/**
 * Resolve the EXISTING shared pool from @workspace/db — the same singleton
 * every other backend query rides. NEVER a second pool.
 *
 * Done via DYNAMIC import on purpose: the scheduler coordinator imports this
 * module unconditionally at load time, and `@workspace/db` throws at import
 * time when DATABASE_URL is unset (plus the vitest alias swaps it for a
 * pool-less pglite harness) — a static import would make the whole
 * coordinator untestable without a database. The lease ops below resolve the
 * pool lazily instead; the runtime module cache makes this cheap.
 */
async function resolveLeasePool(): Promise<PgLeaderLeasePool> {
  if (injectedPool) return injectedPool;
  // Cast through unknown: the production module always exports the pool;
  // the cast keeps "alias without pool" (test harness) a handled runtime
  // branch instead of a module-link crash.
  const mod = (await import("@workspace/db")) as unknown as { pool?: PgLeaderLeasePool };
  if (!mod.pool) {
    throw new Error(
      "[pg-leader-lease] shared db pool unavailable — @workspace/db exported no pool",
    );
  }
  return mod.pool;
}

// ── Statements (single round trip each) ─────────────────────────────────────

const CREATE_LEASE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS scheduler_leader_lease (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
)`;

/**
 * CAS acquire in ONE statement:
 *   - no conflicting row → plain INSERT (first acquire) → RETURNING holder;
 *   - conflict + (lease expired OR we are already the holder) → take over /
 *     re-acquire idempotently → RETURNING holder;
 *   - conflict + unexpired foreign lease → the DO UPDATE WHERE predicate is
 *     not satisfied → zero rows affected → nothing RETURNED → busy.
 */
const ACQUIRE_LEASE_SQL = `
INSERT INTO scheduler_leader_lease (id, holder, expires_at)
VALUES (1, $1, now() + make_interval(secs => $2))
ON CONFLICT (id) DO UPDATE
  SET holder = EXCLUDED.holder,
      expires_at = EXCLUDED.expires_at
  WHERE scheduler_leader_lease.expires_at <= now()
     OR scheduler_leader_lease.holder = EXCLUDED.holder
RETURNING holder`;

/**
 * Renewal that VERIFIES the holder: the row is updated (and returned) only
 * when id=1 is still held by US and has not expired. Any other state
 * (take-over, expiry, never held) yields no row → "lost" — the caller must
 * demote immediately, another instance may be running the schedulers.
 */
const REFRESH_LEASE_SQL = `
UPDATE scheduler_leader_lease
SET expires_at = now() + make_interval(secs => $1)
WHERE id = 1 AND holder = $2 AND expires_at > now()
RETURNING holder`;

/** Release only OUR row (a taken-over lease must not be deleted by us). */
const RELEASE_LEASE_SQL = `
DELETE FROM scheduler_leader_lease
WHERE id = 1 AND holder = $1
RETURNING holder`;

// ── Lazy table bootstrap ────────────────────────────────────────────────────

let tableReady: Promise<void> | null = null;

/**
 * CREATE TABLE IF NOT EXISTS once per process (memoized). Idempotent by
 * construction, so concurrent boots racing the DDL are harmless — worst
 * case one instance gets a transient "error" outcome and its retry loop
 * tries again. A failed bootstrap resets the memo so the next op retries.
 */
function ensureLeaseTable(): Promise<void> {
  if (tableReady) return tableReady;
  const attempt = (async () => {
    const pool = await resolveLeasePool();
    await pool.query(CREATE_LEASE_TABLE_SQL);
  })();
  tableReady = attempt;
  attempt.catch(() => {
    // Only clear OUR memo — a re-injected test pool may have replaced it.
    if (tableReady === attempt) tableReady = null;
  });
  return attempt;
}

// ── Lease operations (never throw) ──────────────────────────────────────────

/** Try to become the lease holder. See module docs for the CAS semantics. */
export async function acquireSchedulerLeaderLease(
  holder: string,
  ttlSec: number,
): Promise<SchedulerLeaseAcquireOutcome> {
  try {
    await ensureLeaseTable();
    const pool = await resolveLeasePool();
    const result = await pool.query(ACQUIRE_LEASE_SQL, [holder, ttlSec]);
    // Holder verification: every winning path (fresh insert, take-over after
    // expiry, same-holder re-acquire) hands back OUR holder via RETURNING.
    const returned = result.rows[0]?.holder;
    return returned === holder ? "acquired" : "busy";
  } catch (err) {
    logger.warn(
      { err, category: "monitoring" },
      "[pg-leader-lease] acquire evaluation failed — will retry (60s lease TTL is the backstop)",
    );
    return "error";
  }
}

/**
 * Renew the lease TTL. "renewed" only when the returned row is OURS — i.e.
 * we are still the verified holder of an unexpired lease.
 */
export async function refreshSchedulerLeaderLease(
  holder: string,
  ttlSec: number,
): Promise<SchedulerLeaseRefreshOutcome> {
  try {
    await ensureLeaseTable();
    const pool = await resolveLeasePool();
    const result = await pool.query(REFRESH_LEASE_SQL, [ttlSec, holder]);
    const returned = result.rows[0]?.holder;
    return returned === holder ? "renewed" : "lost";
  } catch (err) {
    logger.warn(
      { err, category: "monitoring" },
      "[pg-leader-lease] refresh evaluation failed — holdership unverified",
    );
    return "error";
  }
}

/** Delete the lease row — only when we are still the holder. */
export async function releaseSchedulerLeaderLease(
  holder: string,
): Promise<SchedulerLeaseReleaseOutcome> {
  try {
    await ensureLeaseTable();
    const pool = await resolveLeasePool();
    const result = await pool.query(RELEASE_LEASE_SQL, [holder]);
    const returned = result.rows[0]?.holder;
    return returned === holder ? "released" : "not-held";
  } catch (err) {
    logger.warn(
      { err, category: "monitoring" },
      "[pg-leader-lease] release evaluation failed — 60s lease TTL is the backstop",
    );
    return "error";
  }
}

// ── Backend object (what the coordinator consumes) ──────────────────────────

let backend: SchedulerLeaderLeaseBackend | null = null;

/**
 * Memoized lease backend for the scheduler coordinator. The methods resolve
 * the shared pool lazily per call, so the pool seam keeps working without
 * resetting this object.
 */
export function getSchedulerLeaderLeaseBackend(): SchedulerLeaderLeaseBackend {
  if (!backend) {
    backend = {
      acquire: acquireSchedulerLeaderLease,
      refresh: refreshSchedulerLeaderLease,
      release: releaseSchedulerLeaderLease,
    };
  }
  return backend;
}
