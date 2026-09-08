/**
 * Production-safe boot-time schema migration runner.
 *
 * Wraps `runMigrations()` from `migrate.ts` with the operational
 * guarantees needed to run on every cold start of every instance:
 *
 *   1. Write-capability gate (B7-P0-1 Layer 1) — BEFORE touching any DDL
 *      (and before burning the Redis lock TTL) we poll
 *      `pg_is_in_recovery()` + `current_setting('transaction_read_only')`
 *      until the database accepts writes. A Neon pooler failover /
 *      maintenance window presents as read-only for seconds-to-minutes;
 *      Postgres rejects CREATE/ALTER/DROP/DML in that state by command
 *      class EVEN WHEN THE STATEMENT WOULD BE A NO-OP, so any boot that
 *      races the window dies without this gate. Bounded by
 *      MIGRATION_WRITE_WAIT_MAX_MS (default 120 s, env-tunable); poll
 *      cadence MIGRATION_WRITE_WAIT_POLL_MS (default 2 s). Connection
 *      errors during the probe are treated identically to read-only:
 *      keep polling.
 *
 *   2. Distributed Redis lock (NX EX) — prevents concurrent migration
 *      runs across multiple web instances. The first instance to
 *      reach bootMigrations() acquires the lock and runs migrations;
 *      subsequent instances wait for completion before proceeding.
 *      With the lock TTL, a crashed migrating instance does not
 *      block forever — the next cold start retries. The lock TTL is
 *      refreshed before every transient-retry attempt so a long retry
 *      window cannot silently hand the lock to a second instance.
 *
 *   3. Failure classification (B7-P0-1 Layer 2) — three classes:
 *      "idempotent" (object already exists — legacy schema reconcile,
 *      non-fatal), "transient" (SQLSTATE 25006 read-only window,
 *      08006/08003/08001 connection failures, 57P01/57P03 shutdown —
 *      retried by re-running the ENTIRE runMigrations() from the top
 *      with a 5 s → 15 s → 45 s backoff, re-probing writability first;
 *      every statement in migrate.ts is guarded so a full re-run only
 *      re-executes the no-op guards), and "critical" (everything else —
 *      production refuses to start rather than serve traffic on a
 *      broken schema).
 *
 *   4. Operator escape hatch — `DISABLE_BOOT_MIGRATIONS=true` skips
 *      the run entirely. Useful for emergency rollbacks where a
 *      bad migration shipped and the operator needs to bring up the
 *      old binary against the new schema.
 *
 *   5. Observability — every outcome increments a Prom counter
 *      (`migrations_runs_total{outcome}`: ok | idempotent |
 *      skipped_lock | skipped_disabled | critical |
 *      transient_recovered | transient_exhausted), duration is observed
 *      in a histogram, structured Pino logs with category="monitoring",
 *      Sentry breadcrumb on success and captureException on
 *      critical/exhausted failure with rich tags.
 *
 * The lock + classification logic is independent of `runMigrations()`
 * itself — every statement inside `migrate.ts` is already idempotent
 * (uses IF NOT EXISTS / IF EXISTS / catalog pre-checks), so this
 * module is a thin operational shell, not a migration framework.
 */

import * as Sentry from "@sentry/node";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { migrationDurationSeconds, migrationsRunsTotal, safeInc, safeObserve } from "./metrics";
import { getRedisClient } from "./redis-client";
import { runMigrations } from "../migrate";

const LOCK_KEY = "subnation:migrations:lock";
const LOCK_TTL_SEC = 300; // 5 min — generous; longest migration in migrate.ts is ~10s
// F7 (round-94 A6): the follower's wait budget now MATCHES the lock TTL —
// the old 60 s budget opened the boot gate while the leader could still
// legitimately hold the lock (TTL up to 300 s, extended by refreshLockTtl
// through the transient-retry schedule 5/15/45 s). Env-tunable for tests.
const DEFAULT_LEADER_WAIT_MAX_MS = LOCK_TTL_SEC * 1000;
const WAIT_POLL_INTERVAL_MS = 1_000;

// B7-P0-1 Layer 1 defaults (env-tunable; read lazily so tests can set them
// at runtime). The wait budget matches round-92 audit §2.2.
const DEFAULT_WRITE_WAIT_MAX_MS = 120_000;
const DEFAULT_WRITE_WAIT_POLL_MS = 2_000;
// B7-P0-1 Layer 2: transient retry backoff 5 s → 15 s → 45 s (3 attempts).
// Expressed as a base + multipliers so tests can shrink the whole schedule
// via MIGRATION_TRANSIENT_BACKOFF_MS=1.
const TRANSIENT_BACKOFF_MULTIPLIERS = [1, 3, 9];
const DEFAULT_TRANSIENT_BACKOFF_MS = 5_000;

const INSTANCE_ID =
  process.env.RENDER_INSTANCE_ID ??
  `boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export type MigrationOutcome =
  | "ok"
  | "idempotent"
  | "skipped_lock"
  | "skipped_disabled"
  | "critical"
  | "transient_recovered"
  | "transient_exhausted";

export interface MigrationResult {
  ok: boolean;
  outcome: MigrationOutcome;
  durationMs: number;
  error?: string;
  errorCode?: string;
}

function numEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(ms, 1)));

/**
 * SQLSTATEs / errno codes that mark a *transient* failure — the database
 * (or the connection to it) is temporarily unwilling, not broken:
 *
 *   25006 read_only_sql_transaction  — Neon failover/maintenance window
 *   08006 connection_failure          — pooler restart
 *   08003 connection_does_not_exist   — stale pooled connection
 *   08001 sqlclient_unable_to_establish_sqlconnection
 *   57P01 admin_shutdown              — Neon compute suspend/restart
 *   57P03 cannot_connect_now          — starting up / in recovery
 *
 * Node-level socket errors (ECONNRESET etc.) surface with the errno as
 * `err.code` before Postgres can map them to a SQLSTATE.
 */
const TRANSIENT_SQLSTATES = new Set(["25006", "08006", "08003", "08001", "57P01", "57P03"]);
const TRANSIENT_ERRNO_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isTransientError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (typeof code === "string") {
    if (TRANSIENT_SQLSTATES.has(code)) return true;
    if (TRANSIENT_ERRNO_CODES.has(code)) return true;
  }
  // Text fallbacks — the driver may wrap the SQLSTATE away.
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("read-only transaction") ||
    msg.includes("read-only mode") ||
    msg.includes("terminating connection")
  );
}

/**
 * Classify a migration error.
 *
 * "transient" — read-only window / connection loss (see isTransientError).
 * Safe to retry the WHOLE run: every migrate.ts statement is guarded.
 *
 * "idempotent" — Postgres reports the object already exists. Our
 * migrate.ts statements use IF NOT EXISTS guards, so this should
 * not normally happen, but it can if a partial earlier run created
 * an object whose error path is racy. Safe to log + continue.
 *
 * "critical" — anything else: permission denied, type mismatch on
 * ALTER COLUMN, constraint violation, syntax error. Production must
 * refuse to start — running with a broken schema causes user-visible
 * 500s on every code path that touches the affected table.
 */
export function classifyError(err: unknown): "idempotent" | "transient" | "critical" {
  if (isTransientError(err)) return "transient";
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  // Postgres SQLSTATE codes for "already exists":
  //   42P07 duplicate_table
  //   42701 duplicate_column
  //   42710 duplicate_object
  //   42P06 duplicate_schema
  //   42P10 invalid_column_reference (sometimes from re-add idempotency races)
  const code = (err as { code?: string }).code;
  if (code && /^42(P0[67]|710|701)$/.test(code)) return "idempotent";

  // Defensive textual match — error code may be missing (driver wrapping).
  if (
    msg.includes("already exists") ||
    msg.includes("duplicate column") ||
    msg.includes("duplicate object")
  ) {
    return "idempotent";
  }
  return "critical";
}

/**
 * Layer 1 probe: single round-trip, catalog-only reads — allowed even on
 * a read-only standby. `pg_is_in_recovery()` is true ⇔ this connection is
 * pinned to a demoted/standby server (the exact Neon pooler failover
 * state that produced the 25006 deploy kill); `transaction_read_only`
 * covers session/role/DB-level maintenance read-only. Connection errors
 * are folded into "not writable" — the poll loop treats them the same.
 */
export async function isDatabaseWritable(): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT pg_is_in_recovery() AS in_recovery, current_setting('transaction_read_only') AS tro`,
    );
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const row = rows[0];
    return row?.in_recovery === false && row?.tro === "off";
  } catch {
    // Connection failures (08006/08003/57P03 …) — for gating purposes
    // identical to read-only: transient, keep polling.
    return false;
  }
}

export interface WritableWaitOptions {
  /** Override the writability probe (tests / alternate probes). */
  probeFn?: () => Promise<boolean>;
  /** Total wait budget. Defaults to MIGRATION_WRITE_WAIT_MAX_MS (120s). */
  maxWaitMs?: number;
  /** Poll cadence. Defaults to MIGRATION_WRITE_WAIT_POLL_MS (2s). */
  pollMs?: number;
}

/**
 * Layer 1 poll loop: wait until the database accepts writes, bounded by
 * the wait budget. Returns false when the budget is exhausted while the
 * database is still read-only/unreachable — the caller then fails the
 * boot loudly (never serve on a schema we could not reconcile).
 */
export async function waitForWritableDatabase(opts: WritableWaitOptions = {}): Promise<boolean> {
  const probe = opts.probeFn ?? isDatabaseWritable;
  const maxWaitMs =
    opts.maxWaitMs ?? numEnv("MIGRATION_WRITE_WAIT_MAX_MS", DEFAULT_WRITE_WAIT_MAX_MS);
  const pollMs = opts.pollMs ?? numEnv("MIGRATION_WRITE_WAIT_POLL_MS", DEFAULT_WRITE_WAIT_POLL_MS);
  const start = Date.now();
  let announced = false;
  const runProbe = async (): Promise<boolean> => {
    try {
      return await probe();
    } catch {
      // A throwing probe (connection error) is equivalent to "not
      // writable right now" — keep polling.
      return false;
    }
  };
  for (;;) {
    if (await runProbe()) {
      if (announced) {
        logger.info(
          { category: "monitoring", waitMs: Date.now() - start },
          "[migrations] database is writable again — proceeding",
        );
      }
      return true;
    }
    if (!announced) {
      logger.warn(
        { category: "monitoring", maxWaitMs, pollMs },
        "[migrations] database not writable (read-only/standby or unreachable) — waiting before running DDL",
      );
      announced = true;
    } else {
      logger.debug(
        { category: "monitoring", elapsedMs: Date.now() - start },
        "[migrations] still waiting for a writable database",
      );
    }
    if (Date.now() - start >= maxWaitMs) {
      logger.error(
        { category: "monitoring", maxWaitMs },
        "[migrations] timed out waiting for a writable database",
      );
      return false;
    }
    await sleep(pollMs);
  }
}

/** Transient retry schedule: [base, 3×base, 9×base] = 5s/15s/45s by default. */
function transientRetryDelaysMs(): number[] {
  const base = numEnv("MIGRATION_TRANSIENT_BACKOFF_MS", DEFAULT_TRANSIENT_BACKOFF_MS);
  return TRANSIENT_BACKOFF_MULTIPLIERS.map((m) => base * m);
}

async function tryAcquireLock(): Promise<{ acquired: boolean; reason?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    // No Redis → single-instance dev or degraded prod. No coordination
    // needed: just run.
    return { acquired: true, reason: "no_redis" };
  }
  try {
    // SET key value NX EX <ttl> — atomic compare-and-set with TTL.
    const result = await redis.set(LOCK_KEY, INSTANCE_ID, {
      NX: true,
      EX: LOCK_TTL_SEC,
    });
    if (result === "OK") return { acquired: true };
    return { acquired: false, reason: "held_by_other" };
  } catch (err) {
    // Redis transient error — fail open (run anyway). The risk of
    // running concurrently is bounded because every statement is
    // idempotent. The risk of NOT running is the original drift
    // problem this module exists to prevent.
    logger.warn(
      {
        category: "monitoring",
        err: err instanceof Error ? err.message : String(err),
      },
      "[migrations] redis lock acquisition errored — proceeding without lock",
    );
    return { acquired: true, reason: "redis_error" };
  }
}

/** Refresh the lock TTL — only if we still hold it (compare-and-expire). */
async function refreshLockTtl(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`;
    await redis.eval(script, { keys: [LOCK_KEY], arguments: [INSTANCE_ID, String(LOCK_TTL_SEC)] });
  } catch (err) {
    logger.debug(
      {
        category: "monitoring",
        err: err instanceof Error ? err.message : String(err),
      },
      "[migrations] redis lock TTL refresh errored (best-effort)",
    );
  }
}

async function releaseLock(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    // Compare-and-delete: only release if we still hold it. Prevents
    // a slow finishing migration from accidentally releasing a NEW
    // instance's lock that's already started.
    const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
    await redis.eval(script, { keys: [LOCK_KEY], arguments: [INSTANCE_ID] });
  } catch (err) {
    // Lock TTL will expire naturally — not a hard failure.
    logger.debug(
      {
        category: "monitoring",
        err: err instanceof Error ? err.message : String(err),
      },
      "[migrations] redis lock release errored (will expire via TTL)",
    );
  }
}

async function waitForLeader(): Promise<void> {
  const maxWaitMs = numEnv("MIGRATION_LEADER_WAIT_MAX_MS", DEFAULT_LEADER_WAIT_MAX_MS);
  const start = Date.now();
  let redisErrorWarned = false;
  while (Date.now() - start < maxWaitMs) {
    // Re-resolve the client each iteration: the client can drop mid-wait
    // (a stale captured reference would then error every poll) and come
    // back — getRedisClient() reflects readiness.
    const redis = getRedisClient();
    if (redis) {
      try {
        const exists = await redis.exists(LOCK_KEY);
        if (exists === 0) return;
      } catch (err) {
        // F7 (round-94 A6): a Redis error is NOT "the leader finished".
        // The old fail-open `return` opened the boot gate while the leader
        // was still mid-migration (serving traffic on a schema we are still
        // reconciling — the exact contract server.ts forbids). Keep waiting
        // within the TTL-matched budget; one warn, then silent retries.
        if (!redisErrorWarned) {
          redisErrorWarned = true;
          logger.warn(
            {
              category: "monitoring",
              err: err instanceof Error ? err.message : String(err),
              maxWaitMs,
            },
            "[migrations] redis error while waiting for the migration leader — leader state unknown, still waiting (F7)",
          );
        }
      }
    }
    await new Promise((r) => setTimeout(r, WAIT_POLL_INTERVAL_MS));
  }
}

function errDetails(err: unknown): { errorMsg: string; errorCode?: string } {
  return {
    errorMsg: err instanceof Error ? err.message : String(err),
    errorCode: (err as { code?: string }).code,
  };
}

/**
 * Run boot-time migrations with full operational safety.
 *
 * Returns a structured result. Caller is responsible for honoring
 * `result.ok === false` in production (`process.exit(1)`).
 */
export async function bootMigrations(): Promise<MigrationResult> {
  const start = Date.now();
  const observe = (outcome: MigrationOutcome) => {
    const durationMs = Date.now() - start;
    safeObserve(migrationDurationSeconds, {}, durationMs / 1000);
    safeInc(migrationsRunsTotal, { outcome });
    return durationMs;
  };

  // Operator escape hatch — must take precedence over everything else.
  if (process.env.DISABLE_BOOT_MIGRATIONS === "true") {
    const durationMs = observe("skipped_disabled");
    logger.warn(
      { category: "monitoring", durationMs },
      "[migrations] DISABLE_BOOT_MIGRATIONS=true — skipping. Schema drift may accumulate.",
    );
    Sentry.addBreadcrumb({
      category: "migrations",
      level: "warning",
      message: "boot migrations skipped (operator override)",
    });
    return { ok: true, outcome: "skipped_disabled", durationMs };
  }

  // ── Layer 1: write-capability gate (BEFORE the lock — don't burn the
  // 300 s lock TTL while waiting out a failover window). Exhausted →
  // boot fails loudly with outcome "transient_exhausted": we never even
  // attempted DDL against a database we could not write to.
  const writable = await waitForWritableDatabase();
  if (!writable) {
    const durationMs = observe("transient_exhausted");
    const errorMsg = `database not writable after ${durationMs}ms (read-only/standby or unreachable)`;
    logger.error(
      { category: "monitoring", durationMs, instanceId: INSTANCE_ID },
      "[migrations] CRITICAL — database never became writable; production must refuse to start",
    );
    Sentry.captureException(new Error(errorMsg), {
      tags: {
        phase: "boot_migrations",
        classification: "transient_exhausted",
        outcome: "transient_exhausted",
      },
    });
    return { ok: false, outcome: "transient_exhausted", durationMs, error: errorMsg };
  }

  // Acquire the distributed lock. Multi-instance safety: only one
  // instance per region runs migrations at a time.
  const lock = await tryAcquireLock();
  if (!lock.acquired) {
    logger.info(
      { category: "monitoring", instanceId: INSTANCE_ID },
      "[migrations] another instance is migrating — waiting",
    );
    await waitForLeader();
    const durationMs = observe("skipped_lock");
    logger.info(
      { category: "monitoring", durationMs },
      "[migrations] leader finished — proceeding to listen",
    );
    return { ok: true, outcome: "skipped_lock", durationMs };
  }

  // We hold the lock — run the migrations.
  try {
    logger.info(
      {
        category: "monitoring",
        instanceId: INSTANCE_ID,
        lockReason: lock.reason ?? "acquired",
      },
      "[migrations] starting",
    );

    // ── Layer 2: run → classify → transient retry (full re-run from the
    // top). Safe because every statement in migrate.ts is guarded.
    try {
      await runMigrations();
      return finishOk(observe, start);
    } catch (err) {
      const classification = classifyError(err);
      if (classification === "idempotent") {
        return finishIdempotent(observe, start, err, INSTANCE_ID);
      }
      if (classification !== "transient") {
        return finishCritical(observe, start, err, INSTANCE_ID);
      }

      const delays = transientRetryDelaysMs();
      let lastError = err;
      for (let attempt = 1; attempt <= delays.length; attempt++) {
        const delayMs = delays[attempt - 1];
        const { errorMsg, errorCode } = errDetails(lastError);
        logger.warn(
          {
            category: "monitoring",
            attempt,
            totalAttempts: delays.length,
            delayMs,
            err: errorMsg,
            code: errorCode,
            instanceId: INSTANCE_ID,
          },
          "[migrations] transient failure (read-only window / connection loss) — retrying the full run from the top",
        );
        await sleep(delayMs);
        // Long retry windows must not outlive the 300s lock TTL.
        await refreshLockTtl();
        // Re-probe writability BEFORE burning another attempt.
        if (!(await waitForWritableDatabase())) {
          const durationMs = observe("transient_exhausted");
          const exhaustedMsg = `database not writable before transient retry ${attempt}/${delays.length}`;
          logger.error(
            { category: "monitoring", durationMs, instanceId: INSTANCE_ID, err: errorMsg },
            "[migrations] CRITICAL — transient failures exhausted; production must refuse to start",
          );
          Sentry.captureException(lastError, {
            tags: {
              phase: "boot_migrations",
              classification: "transient_exhausted",
              outcome: "transient_exhausted",
            },
            extra: { instanceId: INSTANCE_ID, durationMs, errorCode, reason: exhaustedMsg },
          });
          return {
            ok: false,
            outcome: "transient_exhausted",
            durationMs,
            error: `${exhaustedMsg}: ${errorMsg}`,
            errorCode,
          };
        }
        try {
          await runMigrations();
          // Recovered — outcome distinguishes this from a clean first pass
          // so ops can observe Neon failover frequency.
          const durationMs = observe("transient_recovered");
          const { errorMsg: recoveredFrom } = errDetails(lastError);
          logger.warn(
            {
              category: "monitoring",
              durationMs,
              attempt,
              instanceId: INSTANCE_ID,
              recoveredFrom,
            },
            "[migrations] transient failure recovered — schema is consistent",
          );
          Sentry.addBreadcrumb({
            category: "migrations",
            level: "warning",
            message: "boot migrations: transient failure recovered",
            data: { durationMs, attempt, recoveredFrom, instanceId: INSTANCE_ID },
          });
          return {
            ok: true,
            outcome: "transient_recovered",
            durationMs,
            error: recoveredFrom,
          };
        } catch (retryErr) {
          lastError = retryErr;
          const retryClass = classifyError(retryErr);
          if (retryClass === "idempotent") {
            return finishIdempotent(observe, start, retryErr, INSTANCE_ID);
          }
          if (retryClass !== "transient") {
            return finishCritical(observe, start, retryErr, INSTANCE_ID);
          }
          // transient again → fall through to the next backoff.
        }
      }

      // Exhausted all retries — fail LOUDLY (never serve on a broken
      // schema), but now only after ~2 min of genuine retry instead of 0s.
      const durationMs = observe("transient_exhausted");
      const { errorMsg, errorCode } = errDetails(lastError);
      logger.error(
        {
          category: "monitoring",
          durationMs,
          instanceId: INSTANCE_ID,
          err: errorMsg,
          code: errorCode,
        },
        "[migrations] CRITICAL — transient failures exhausted; production must refuse to start",
      );
      Sentry.captureException(lastError, {
        tags: {
          phase: "boot_migrations",
          classification: "transient_exhausted",
          outcome: "transient_exhausted",
        },
        extra: { instanceId: INSTANCE_ID, durationMs, errorCode },
      });
      return {
        ok: false,
        outcome: "transient_exhausted",
        durationMs,
        error: errorMsg,
        errorCode,
      };
    }
  } finally {
    // Always attempt to release. Compare-and-delete prevents stealing
    // a new lock if our run was already de-facto abandoned.
    await releaseLock();
  }
}

function finishOk(observe: (o: MigrationOutcome) => number, start: number): MigrationResult {
  const durationMs = observe("ok");
  logger.info(
    { category: "monitoring", durationMs, instanceId: INSTANCE_ID },
    "[migrations] completed cleanly",
  );
  Sentry.addBreadcrumb({
    category: "migrations",
    level: "info",
    message: "boot migrations completed",
    data: { durationMs, instanceId: INSTANCE_ID, startedAt: start },
  });
  return { ok: true, outcome: "ok", durationMs };
}

function finishIdempotent(
  observe: (o: MigrationOutcome) => number,
  start: number,
  err: unknown,
  instanceId: string,
): MigrationResult {
  const durationMs = observe("idempotent");
  const { errorMsg, errorCode } = errDetails(err);
  logger.warn(
    { category: "monitoring", err: errorMsg, code: errorCode, durationMs, instanceId },
    "[migrations] idempotent error swallowed — schema already up to date",
  );
  Sentry.addBreadcrumb({
    category: "migrations",
    level: "warning",
    message: "boot migrations: idempotent error",
    data: { errorMsg, errorCode, durationMs, startedAt: start },
  });
  return { ok: true, outcome: "idempotent", durationMs, error: errorMsg, errorCode };
}

function finishCritical(
  observe: (o: MigrationOutcome) => number,
  start: number,
  err: unknown,
  instanceId: string,
): MigrationResult {
  const durationMs = observe("critical");
  const { errorMsg, errorCode } = errDetails(err);
  logger.error(
    { category: "monitoring", err: errorMsg, code: errorCode, durationMs, instanceId },
    "[migrations] CRITICAL failure — production must refuse to start",
  );
  Sentry.captureException(err, {
    tags: {
      phase: "boot_migrations",
      classification: "critical",
      outcome: "critical",
    },
    extra: { instanceId, durationMs, errorCode, startedAt: start },
  });
  return { ok: false, outcome: "critical", durationMs, error: errorMsg, errorCode };
}
