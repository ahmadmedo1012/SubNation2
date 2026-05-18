/**
 * Production-safe boot-time schema migration runner.
 *
 * Wraps `runMigrations()` from `migrate.ts` with the operational
 * guarantees needed to run on every cold start of every instance:
 *
 *   1. Distributed Redis lock (NX EX) — prevents concurrent migration
 *      runs across multiple web instances. The first instance to
 *      reach bootMigrations() acquires the lock and runs migrations;
 *      subsequent instances wait for completion before proceeding.
 *      With the lock TTL, a crashed migrating instance does not
 *      block forever — the next cold start retries.
 *
 *   2. Failure classification — Postgres errors that indicate
 *      "object already exists" are non-fatal (legacy schema reconcile,
 *      idempotent re-run). All other errors are critical and the
 *      caller in production MUST refuse to bring up the listener.
 *
 *   3. Operator escape hatch — `DISABLE_BOOT_MIGRATIONS=true` skips
 *      the run entirely. Useful for emergency rollbacks where a
 *      bad migration shipped and the operator needs to bring up the
 *      old binary against the new schema.
 *
 *   4. Observability — every outcome increments a Prom counter,
 *      duration is observed in a histogram, structured Pino logs
 *      with category="monitoring", Sentry breadcrumb on success
 *      and captureException on critical failure with rich tags.
 *
 * The lock + classification logic is independent of `runMigrations()`
 * itself — every statement inside `migrate.ts` is already idempotent
 * (uses IF NOT EXISTS / IF EXISTS / DROP NOT NULL guards), so this
 * module is a thin operational shell, not a migration framework.
 */

import * as Sentry from "@sentry/node";
import { logger } from "./logger";
import {
  migrationDurationSeconds,
  migrationsRunsTotal,
  safeInc,
  safeObserve,
} from "./metrics";
import { getRedisClient } from "./redis-client";
import { runMigrations } from "../migrate";

const LOCK_KEY = "subnation:migrations:lock";
const LOCK_TTL_SEC = 300; // 5 min — generous; longest migration in migrate.ts is ~10s
const WAIT_FOR_LEADER_MAX_MS = 60_000; // 1 min — if leader takes longer, assume done
const WAIT_POLL_INTERVAL_MS = 1_000;

const INSTANCE_ID =
  process.env.RENDER_INSTANCE_ID ??
  `boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export type MigrationOutcome =
  | "ok"
  | "idempotent"
  | "skipped_lock"
  | "skipped_disabled"
  | "critical";

export interface MigrationResult {
  ok: boolean;
  outcome: MigrationOutcome;
  durationMs: number;
  error?: string;
  errorCode?: string;
}

/**
 * Classify a migration error.
 *
 * "idempotent" — Postgres reports the object already exists. Our
 * migrate.ts statements use IF NOT EXISTS guards, so this should
 * not normally happen, but it can if a partial earlier run created
 * an object whose error path is racy. Safe to log + continue.
 *
 * "critical" — anything else: connection failure, permission denied,
 * type mismatch on ALTER COLUMN, constraint violation, syntax error.
 * Production must refuse to start — running with a broken schema
 * causes user-visible 500s on every code path that touches the
 * affected table.
 */
function classifyError(err: unknown): "idempotent" | "critical" {
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
  const redis = getRedisClient();
  if (!redis) return;
  const start = Date.now();
  while (Date.now() - start < WAIT_FOR_LEADER_MAX_MS) {
    try {
      const exists = await redis.exists(LOCK_KEY);
      if (exists === 0) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, WAIT_POLL_INTERVAL_MS));
  }
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

    await runMigrations();

    const durationMs = observe("ok");
    logger.info(
      { category: "monitoring", durationMs, instanceId: INSTANCE_ID },
      "[migrations] completed cleanly",
    );
    Sentry.addBreadcrumb({
      category: "migrations",
      level: "info",
      message: "boot migrations completed",
      data: { durationMs, instanceId: INSTANCE_ID },
    });
    return { ok: true, outcome: "ok", durationMs };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCode = (err as { code?: string }).code;
    const classification = classifyError(err);

    if (classification === "idempotent") {
      const durationMs = observe("idempotent");
      logger.warn(
        {
          category: "monitoring",
          err: errorMsg,
          code: errorCode,
          durationMs,
          instanceId: INSTANCE_ID,
        },
        "[migrations] idempotent error swallowed — schema already up to date",
      );
      Sentry.addBreadcrumb({
        category: "migrations",
        level: "warning",
        message: "boot migrations: idempotent error",
        data: { errorMsg, errorCode, durationMs },
      });
      return {
        ok: true,
        outcome: "idempotent",
        durationMs,
        error: errorMsg,
        errorCode,
      };
    }

    // Critical failure path. Production caller must exit.
    const durationMs = observe("critical");
    logger.error(
      {
        category: "monitoring",
        err: errorMsg,
        code: errorCode,
        durationMs,
        instanceId: INSTANCE_ID,
      },
      "[migrations] CRITICAL failure — production must refuse to start",
    );
    Sentry.captureException(err, {
      tags: {
        phase: "boot_migrations",
        classification: "critical",
        outcome: "critical",
      },
      extra: {
        instanceId: INSTANCE_ID,
        durationMs,
        errorCode,
      },
    });
    return {
      ok: false,
      outcome: "critical",
      durationMs,
      error: errorMsg,
      errorCode,
    };
  } finally {
    // Always attempt to release. Compare-and-delete prevents stealing
    // a new lock if our run was already de-facto abandoned.
    await releaseLock();
  }
}
