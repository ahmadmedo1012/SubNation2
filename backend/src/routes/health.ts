import { HealthCheckResponse } from "@workspace/api-zod";
import { db as neonDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getFirebaseAdminApp, getFirebaseAdminAuth } from "../lib/firebase-admin";
import { getRedisClient, withRedisCommandTimeout } from "../lib/redis-client";
import { getSchedulerState, type SchedulerStateSnapshot } from "../lib/scheduler-state";
import { getIO } from "../lib/socket";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

// ──────────────────────────────────────────────────────────────────────────────
// Aggregate readiness cache.
//
// 75 concurrent users polling /healthz/summary every 30-60 s would otherwise
// trigger a fresh Redis ping + Neon SELECT 1 + worker heartbeat read +
// Socket.IO check on every request — saturating the event loop on a
// 0.5-CPU starter dyno. We compute the aggregate at most once per
// CACHE_TTL_MS and serve every other request from the in-memory cache.
//
// The cache is process-local. With multiple web instances the cache
// fans out per-instance, which is correct: each instance reports its
// own readiness, and the load multiplier is bounded by N_instances
// rather than N_concurrent_users.
// ──────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 15_000;
let cachedResponse: { value: HealthCheckResponseExtended; expiresAt: number } | null = null;
let inflight: Promise<HealthCheckResponseExtended> | null = null;

// R3 (round-93 A3): absolute bound on the shared in-flight aggregate. The
// old computation could wedge FOREVER during a Redis outage (a queued
// failure-counter INCR never settles → checkRedis never returns → `inflight`
// never resolves and is never cleared → every subsequent /healthz/summary
// request shares the dead promise). Env-overridable for tests + ops.
const DEFAULT_AGGREGATE_TIMEOUT_MS = 8_000;

function aggregateTimeoutMs(): number {
  const raw = Number(process.env.HEALTH_AGGREGATE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AGGREGATE_TIMEOUT_MS;
}

// ──────────────────────────────────────────────────────────────────────────────
// Health check types and interfaces
// ──────────────────────────────────────────────────────────────────────────────

type CheckStatus = "ok" | "degraded" | "failing";

interface CheckResult {
  status: CheckStatus;
  /**
   * `true` if this subsystem is informational only — its failure does NOT
   * block readiness. Surfaced so the frontend can render optional
   * failures without an alarming red state.
   *
   * Critical checks (default `false` / unset): neon (DB), redis.
   * Optional checks (`true`): worker, socket — single-tier deployments
   * and early boot can legitimately leave these absent without breaking
   * the app.
   */
  optional?: boolean;
  latencyMs?: number;
  error?: string;
  /** Friendly note for operators (e.g. "single-tier deployment"). */
  note?: string;
  lastCheckedAt: string;
}

interface HealthCheckResponseExtended {
  status: CheckStatus;
  checks: Record<string, CheckResult>;
  /**
   * R101 (dark-scheduler visibility): this-process scheduler topology
   * snapshot (mode / active / isLeader / reason) — INFORMATIONAL, never
   * folded into `status`. /healthz used to read green while the
   * schedulers were dark (no leader anywhere: alerting itself only runs
   * ON the leader — the egg-and-chicken gap). Surfacing the snapshot
   * here gives operators the full truth in one admin pane; the
   * scheduler-state reasons line up with the admin observability
   * endpoint and metrics-snapshot labels.
   */
  scheduler: SchedulerStateSnapshot;
  version: string;
  uptimeSec: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Failure counter helpers (Redis-backed, BEST-EFFORT)
//
// R3 (round-93 A3): these helpers used to await raw `redis.incr/get/del`
// calls. During a runtime outage node-redis QUEUES those commands and they
// never settle — so checkRedis's catch path never returned and the whole
// /healthz/summary aggregate wedged permanently. They are now (a) mostly
// fire-and-forget (the counters are documentation-grade signals, never
// gatekeepers) and (b) individually bounded by a short command timeout so
// even the awaited reads resolve fast.
// ──────────────────────────────────────────────────────────────────────────────

const FAILURE_COUNTER_PREFIX = "health:fail:";
const FAILURE_WINDOW_MS = 30_000; // 30 seconds
const FAILURE_COUNTER_TIMEOUT_MS = 250;

async function getFailureCount(redis: any, checkName: string): Promise<number> {
  try {
    const key = `${FAILURE_COUNTER_PREFIX}${checkName}`;
    const value = await withRedisCommandTimeout<string | null>(
      `health_fail_get_${checkName}`,
      () => redis.get(key),
      FAILURE_COUNTER_TIMEOUT_MS,
    );
    return parseInt(value || "0", 10);
  } catch {
    // Timeout / error — treat as "no recent failures recorded".
    return 0;
  }
}

function incrementFailureCounter(redis: any, checkName: string): void {
  const key = `${FAILURE_COUNTER_PREFIX}${checkName}`;
  void withRedisCommandTimeout(
    `health_fail_incr_${checkName}`,
    () => redis.incr(key),
    FAILURE_COUNTER_TIMEOUT_MS,
  ).catch(() => {
    /* best-effort counter */
  });
  void withRedisCommandTimeout(
    `health_fail_expire_${checkName}`,
    () => redis.expire(key, Math.ceil(FAILURE_WINDOW_MS / 1000)),
    FAILURE_COUNTER_TIMEOUT_MS,
  ).catch(() => {
    /* best-effort counter */
  });
}

function clearFailureCounter(redis: any, checkName: string): void {
  const key = `${FAILURE_COUNTER_PREFIX}${checkName}`;
  void withRedisCommandTimeout(
    `health_fail_clear_${checkName}`,
    () => redis.del(key),
    FAILURE_COUNTER_TIMEOUT_MS,
  ).catch(() => {
    /* best-effort counter */
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Health check implementations
// ──────────────────────────────────────────────────────────────────────────────

// R3 (round-93 A3): per-check race budget. Function (not const) so tests
// and ops can retune it at runtime without a re-import.
function checkTimeoutMs(): number {
  const raw = Number(process.env.HEALTH_CHECK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
}

/** Test seam: reset the aggregate cache + in-flight slot + neon streak. */
export function resetReadyStateForTests(): void {
  cachedResponse = null;
  inflight = null;
  neonConsecutiveFailures = 0;
}

async function checkRedis(redis: any): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), checkTimeoutMs()),
      ),
    ]);
    const latencyMs = Date.now() - start;

    if (result === "PONG") {
      // Reset failure counter on success (fire-and-forget, R3).
      clearFailureCounter(redis, "redis");
      return {
        status: latencyMs > 200 ? "degraded" : "ok",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      incrementFailureCounter(redis, "redis");
      const failures = await getFailureCount(redis, "redis");
      return {
        status: failures >= 3 ? "failing" : "degraded",
        latencyMs,
        error: `Unexpected response: ${result}`,
        lastCheckedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    // R3 (round-93 A3): fire-and-forget counter — the old `await` landed on
    // a queued INCR that never settled during a Redis outage, wedging this
    // check (and the whole /healthz/summary aggregate) forever.
    incrementFailureCounter(redis, "redis");
    const failures = await getFailureCount(redis, "redis");
    return {
      status: failures >= 3 ? "failing" : "degraded",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Neon failure tracking (B7-P1-4, round-92)
//
// The failure counters previously lived ONLY in Redis — with REDIS_URL
// unset (current production shape) `incrementFailureCounter` no-ops, so a
// TOTAL database outage kept reporting status "degraded" (failures=0)
// and /healthz/summary stayed HTTP 200 forever. Health was not truthful
// about the one dependency that matters.
//
// The in-process consecutive-failure streak below is the fallback: a
// process-local window is sufficient for a single-instance deployment
// (the current shape), and it works with or without Redis. When Redis IS
// available the Redis window counter keeps its original semantics (2
// failures inside a 30 s window); without it, 2 consecutive failed
// aggregates escalate the check to "failing" → /healthz/summary 503.
// ─────────────────────────────────────────────────────────────────────────────

const NEON_FAILURES_TO_FAILING = 2;
let neonConsecutiveFailures = 0;

/** Test seam: reset the in-process Neon failure streak. */
export function resetNeonFailureStreakForTests(): void {
  neonConsecutiveFailures = 0;
}

/**
 * checkNeon with an injectable probe (exported for unit tests — the real
 * probe is `neonDb.execute(sql`SELECT 1`)` on the Neon pool, which cannot
 * be made to fail deterministically in the pglite test harness).
 */
export async function checkNeonWith(probe: () => Promise<unknown>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      probe(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Neon query timeout")), checkTimeoutMs()),
      ),
    ]);
    const latencyMs = Date.now() - start;

    if (result) {
      // Success resets BOTH counters — the streak is "consecutive"
      // by definition.
      neonConsecutiveFailures = 0;
      const redis = getRedisClient();
      if (redis) clearFailureCounter(redis, "neon");
      return {
        status: latencyMs > 500 ? "degraded" : "ok",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      neonConsecutiveFailures += 1;
      const redis = getRedisClient();
      if (redis) incrementFailureCounter(redis, "neon");
      const failures = redis ? await getFailureCount(redis, "neon") : neonConsecutiveFailures;
      return {
        status: failures >= NEON_FAILURES_TO_FAILING ? "failing" : "degraded",
        latencyMs,
        error: "Query returned no result",
        lastCheckedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    neonConsecutiveFailures += 1;
    const redis = getRedisClient();
    if (redis) incrementFailureCounter(redis, "neon");
    const failures = redis ? await getFailureCount(redis, "neon") : neonConsecutiveFailures;
    return {
      status: failures >= NEON_FAILURES_TO_FAILING ? "failing" : "degraded",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function checkNeon(): Promise<CheckResult> {
  return checkNeonWith(() => neonDb.execute(sql`SELECT 1`));
}

async function checkWorker(redis: any): Promise<CheckResult> {
  const start = Date.now();
  const now = Date.now();
  // Worker is OPTIONAL — single-tier deployments don't run a separate
  // worker process, and the web tier handles schedulers via the
  // Redis-backed leader lock. An absent worker is by-design, not an
  // error. Only escalate to "failing" if a heartbeat exists but is
  // very stale (~3 minutes), indicating a crashed/lagging worker.
  const optional = true;

  try {
    const heartbeat = await Promise.race([
      redis.get("worker:heartbeat"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Worker heartbeat timeout")), checkTimeoutMs()),
      ),
    ]);

    if (!heartbeat) {
      return {
        status: "degraded",
        optional,
        latencyMs: Date.now() - start,
        note: "single-tier deployment (no separate worker process)",
        lastCheckedAt: new Date().toISOString(),
      };
    }

    const parsed = JSON.parse(heartbeat);
    const ageSec = (now - parsed.ts) / 1000;

    if (ageSec > 180) {
      return {
        status: "failing",
        optional,
        latencyMs: Date.now() - start,
        error: `Worker heartbeat too old: ${ageSec.toFixed(1)}s`,
        lastCheckedAt: new Date().toISOString(),
      };
    } else if (ageSec > 60) {
      return {
        status: "degraded",
        optional,
        latencyMs: Date.now() - start,
        error: `Worker heartbeat age: ${ageSec.toFixed(1)}s`,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      return {
        status: "ok",
        optional,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    return {
      status: "degraded",
      optional,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function checkSocket(io: any, redis: any): Promise<CheckResult> {
  const start = Date.now();
  // Socket.IO is OPTIONAL — its absence degrades realtime UX (live order
  // / topup notifications) but every critical request path (HTTP API,
  // auth, orders, wallet) functions fine without it.
  const optional = true;

  try {
    if (!io || !io.adapter) {
      return {
        status: "degraded",
        optional,
        latencyMs: Date.now() - start,
        note: "Socket.IO not initialized — realtime updates may not be delivered",
        lastCheckedAt: new Date().toISOString(),
      };
    }

    // Use Redis pub/sub ping to check Socket.IO adapter reachability.
    // R3 (round-93 A3): the ping itself is command-timeout bounded so a
    // queued command on a dead socket cannot wedge the aggregate.
    const result = await Promise.race([
      withRedisCommandTimeout("health_socket_ping", () => redis.ping()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Socket.IO adapter timeout")), checkTimeoutMs()),
      ),
    ]);

    if (result === "PONG") {
      return {
        status: "ok",
        optional,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      return {
        status: "degraded",
        optional,
        latencyMs: Date.now() - start,
        error: `Unexpected Redis response: ${result}`,
        lastCheckedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    return {
      status: "degraded",
      optional,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function checkRiskPipeline(redis: any): Promise<CheckResult> {
  const start = Date.now();
  // Risk pipeline is OPTIONAL — the rest of the platform works
  // even if scoring is disabled or degraded (per spec §1 Edge
  // Cases / FR-010). Surfaces yellow when degraded, red only
  // when the pipeline is enabled but scoring fails repeatedly.
  const optional = true;

  if (process.env.RISK_PIPELINE_ENABLED !== "true") {
    return {
      status: "ok",
      optional,
      latencyMs: Date.now() - start,
      note: "risk pipeline disabled (RISK_PIPELINE_ENABLED=false)",
      lastCheckedAt: new Date().toISOString(),
    };
  }

  try {
    if (!redis) {
      return {
        status: "degraded",
        optional,
        latencyMs: Date.now() - start,
        note: "redis unavailable — risk-config cache cannot serve",
        lastCheckedAt: new Date().toISOString(),
      };
    }
    // The scoring service writes a `risk:pipeline:degraded`
    // key on internal failure with a 5-min TTL. Presence ⇒
    // degraded, absence ⇒ ok. R3: bounded — the old raw get hung
    // the aggregate when Redis queued the command during an outage.
    const degraded = await withRedisCommandTimeout(
      "health_risk_degraded",
      () => redis.get("risk:pipeline:degraded"),
      FAILURE_COUNTER_TIMEOUT_MS,
    );
    return {
      status: degraded ? "degraded" : "ok",
      optional,
      latencyMs: Date.now() - start,
      note: degraded ? "scoring degraded to rules-only in last 5 min" : undefined,
      lastCheckedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "degraded",
      optional,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Route handlers
// ──────────────────────────────────────────────────────────────────────────────

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Diagnostic endpoint — admin-gated. Leaks deployment config (Firebase
// project id, service-account-JSON shape, env presence) so MUST NOT be
// exposed to public users.
router.get("/healthz/firebase", requireAdmin, async (_req, res) => {
  const flagEnabled = process.env.FIREBASE_AUTH_ENABLED === "true";
  const projectIdEnv = process.env.FIREBASE_PROJECT_ID || null;
  const hasServiceAccountJson = !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const hasClientEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
  const hasPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;

  // Check JSON parseability without leaking content
  let serviceAccountValid = false;
  let serviceAccountProjectId: string | null = null;
  let parseError: string | null = null;
  if (hasServiceAccountJson) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
      serviceAccountValid =
        typeof parsed.client_email === "string" &&
        typeof parsed.private_key === "string" &&
        parsed.private_key.includes("BEGIN PRIVATE KEY");
      serviceAccountProjectId = typeof parsed.project_id === "string" ? parsed.project_id : null;
    } catch (err) {
      parseError = err instanceof Error ? err.message : "unknown parse error";
    }
  }

  const app = await getFirebaseAdminApp();
  const auth = await getFirebaseAdminAuth();

  res.json({
    auth_enabled_flag: flagEnabled,
    project_id_env: projectIdEnv,
    has_service_account_json: hasServiceAccountJson,
    has_client_email: hasClientEmail,
    has_private_key: hasPrivateKey,
    service_account_parse_ok: serviceAccountValid,
    service_account_project_id: serviceAccountProjectId,
    service_account_project_matches_env:
      serviceAccountProjectId !== null && serviceAccountProjectId === projectIdEnv,
    service_account_parse_error: parseError,
    admin_app_initialized: app !== null,
    admin_auth_initialized: auth !== null,
  });
});

// Ready endpoint — aggregates health checks with critical/optional semantics.
//
// Status escalation rules:
//   - "failing": ANY non-optional check is failing → HTTP 503
//   - "degraded": ANY check (incl. optional) is failing OR degraded → HTTP 200
//   - "ok": all checks pass → HTTP 200
//
// Critical checks (block readiness): neon (DB), redis.
// Optional checks (informational): worker, socket.
//
// This separation kills the false-positive 503s that the previous
// blanket policy produced in single-tier deployments (no separate
// worker process) and during transient Socket.IO blips. The platform
// is "ready" if it can serve user-facing traffic — auth, orders,
// wallet, etc. — which only requires DB + Redis.
//
// IMPORTANT: This endpoint is admin-gated (`requireAdmin`). The full
// per-check breakdown exposes infrastructure details that are not
// safe to surface to public users. The public-safe surface is
// `/api/healthz/summary` which returns only the status discriminator.

export async function computeReadyState(): Promise<HealthCheckResponseExtended> {
  // De-dup concurrent computations — if N requests miss the cache at
  // the same time we run the aggregate ONCE, not N times. R3: the shared
  // promise is now BOUNDED (see boundedAggregate below) — concurrent
  // callers can no longer inherit an eternally-pending aggregate.
  if (inflight) return inflight;

  const raw = (async () => {
    const redis = getRedisClient();
    const io = getIO();

    const checks: Record<string, CheckResult> = {};
    let overallStatus: CheckStatus = "ok";

    const fold = (result: CheckResult) => {
      if (result.status === "failing") {
        if (result.optional === true) {
          if (overallStatus === "ok") overallStatus = "degraded";
        } else {
          overallStatus = "failing";
        }
      } else if (result.status === "degraded" && overallStatus === "ok") {
        overallStatus = "degraded";
      }
    };

    if (redis) {
      const result = await checkRedis(redis);
      checks.redis = result;
      fold(result);
    } else if (!process.env.REDIS_URL) {
      // Intentional single-tier mode (redis-client.ts CASE 1): no URL set,
      // in-memory stores active. This is a deliberate operator choice —
      // degraded (yellow), NOT failing (red). Marking it "failing" made the
      // public /status page show an outage during normal operation.
      checks.redis = {
        status: "degraded",
        optional: true,
        error: "REDIS_URL not configured — in-memory fallback (single-instance mode)",
        lastCheckedAt: new Date().toISOString(),
      };
      fold(checks.redis);
    } else {
      // URL is configured but the client failed to connect — real outage.
      checks.redis = {
        status: "failing",
        error: "Redis configured but unavailable",
        lastCheckedAt: new Date().toISOString(),
      };
      fold(checks.redis);
    }

    {
      const result = await checkNeon();
      checks.neon = result;
      fold(result);
    }

    if (redis) {
      const result = await checkWorker(redis);
      checks.worker = result;
      fold(result);
    } else {
      checks.worker = {
        status: "degraded",
        optional: true,
        note: "Redis unavailable — worker heartbeat not checked",
        lastCheckedAt: new Date().toISOString(),
      };
      fold(checks.worker);
    }

    if (io && redis) {
      const result = await checkSocket(io, redis);
      checks.socket = result;
      fold(result);
    } else {
      checks.socket = {
        status: "degraded",
        optional: true,
        note: !io ? "Socket.IO not initialized" : "Redis unavailable — adapter not checked",
        lastCheckedAt: new Date().toISOString(),
      };
      fold(checks.socket);
    }

    {
      const result = await checkRiskPipeline(redis);
      checks.risk_pipeline = result;
      fold(result);
    }

    const version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "unknown";
    const uptimeSec = Math.floor(process.uptime());

    return {
      status: overallStatus as CheckStatus,
      checks,
      scheduler: getSchedulerState(),
      version,
      uptimeSec,
    };
  })();

  const bounded = boundedAggregate(raw);
  inflight = bounded;
  return bounded;
}

/**
 * R3 (round-93 A3): race the aggregate against an absolute deadline.
 *
 * The old code awaited the raw computation and cleared `inflight` in a
 * `finally` — which only runs once the computation settles. During a Redis
 * outage (pre-R2/R3) the queued failure-counter INCR never settled, so the
 * aggregate never settled, so `finally` never ran: every subsequent
 * /healthz/summary request shared the dead promise and hung forever. Even
 * with the inner ops now bounded, this outer race guarantees the public
 * status endpoint ALWAYS answers — a slow subsystem degrades the snapshot
 * instead of wedging it. The timed-out snapshot is NOT cached.
 */
async function boundedAggregate(
  raw: Promise<HealthCheckResponseExtended>,
): Promise<HealthCheckResponseExtended> {
  const timeoutMs = aggregateTimeoutMs();
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      raw,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("health_aggregate_timeout")), timeoutMs);
      }),
    ]);
    cachedResponse = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (err) {
    logger.warn(
      { err, category: "monitoring", timeoutMs },
      "[health] readiness aggregate timed out — returning a degraded snapshot and resetting the in-flight promise",
    );
    return degradedAggregateSnapshot(err);
  } finally {
    if (timer) clearTimeout(timer);
    // Reset the shared slot in ALL settle paths — success, timeout, or
    // rejection. This is the actual R3 fix: `inflight` must never stay
    // pointing at a promise that will not settle.
    inflight = null;
  }
}

/** Never-cached degraded snapshot for the aggregate-timeout path. */
function degradedAggregateSnapshot(err: unknown): HealthCheckResponseExtended {
  return {
    status: "degraded",
    checks: {
      aggregate: {
        status: "degraded",
        optional: true,
        error: err instanceof Error ? err.message : "aggregate timed out",
        lastCheckedAt: new Date().toISOString(),
      },
    },
    scheduler: getSchedulerState(),
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "unknown",
    uptimeSec: Math.floor(process.uptime()),
  };
}

async function getReadyState(): Promise<HealthCheckResponseExtended> {
  if (cachedResponse && Date.now() < cachedResponse.expiresAt) {
    return cachedResponse.value;
  }
  return computeReadyState();
}

// Public summary — status-only. Safe to expose to anonymous users:
// no per-check details, no version, no uptime, no infrastructure
// information. Used by the public /status page and any future
// operational-transparency surface.
router.get("/healthz/summary", async (_req, res) => {
  try {
    const state = await getReadyState();
    res.set("Cache-Control", "public, max-age=15");
    res.status((state.status as CheckStatus) === "failing" ? 503 : 200).json({
      status: state.status,
    });
  } catch {
    // Fail-open with degraded status — the platform itself isn't broken,
    // we just couldn't aggregate. Public users see a yellow indicator,
    // not an error.
    res.status(200).json({ status: "degraded" });
  }
});

// Admin-gated detailed readiness. Returns the full per-check breakdown
// for operators on /admin/system. Cached aggregate so even admin
// polling at 30 s × N admins doesn't dominate the event loop.
router.get("/healthz/ready", requireAdmin, async (_req, res) => {
  try {
    const state = await getReadyState();
    res.status((state.status as CheckStatus) === "failing" ? 503 : 200).json(state);
  } catch (err) {
    res.status(500).json({
      status: "failing",
      error: err instanceof Error ? err.message : "aggregation failed",
    });
  }
});

// Liveness probe — PUBLIC, no auth, no DB, no Redis, no I/O.
// Pure "is this process alive and serving HTTP?" signal for
// Kubernetes / Render / load balancers. Always returns 200 as long
// as the event loop is responsive. A failing dependency is NOT a
// liveness failure — that is what /healthz/ready (admin-gated) is
// for. Conflating the two caused false-positive pod restarts in
// the past when the DB blipped.
router.get("/healthz/live", (_req, res) => {
  res.set("Cache-Control", "public, max-age=5");
  res.status(200).json({ status: "ok" });
});

// Per-subsystem health endpoints — admin-gated. Each leaks latency +
// error messages + state details that are not safe to expose
// publicly. The public surface is /healthz/summary.
router.get("/healthz/redis", requireAdmin, async (_req, res): Promise<void> => {
  const redis = getRedisClient();

  if (!redis) {
    res.status(503).json({
      status: "failing",
      error: "Redis not configured",
      lastCheckedAt: new Date().toISOString(),
    });
    return;
  }

  const result = await checkRedis(redis);
  res.status(result.status === "failing" ? 503 : 200).json(result);
});

router.get("/healthz/neon", requireAdmin, async (_req, res): Promise<void> => {
  const result = await checkNeon();
  res.status(result.status === "failing" ? 503 : 200).json(result);
});

router.get("/healthz/worker", requireAdmin, async (_req, res): Promise<void> => {
  const redis = getRedisClient();

  if (!redis) {
    res.status(503).json({
      status: "failing",
      error: "Redis not configured (needed for worker heartbeat check)",
      lastCheckedAt: new Date().toISOString(),
    });
    return;
  }

  const result = await checkWorker(redis);
  res.status(result.status === "failing" ? 503 : 200).json(result);
});

router.get("/healthz/socket", requireAdmin, async (_req, res): Promise<void> => {
  const io = getIO();
  const redis = getRedisClient();

  if (!io || !redis) {
    res.status(503).json({
      status: "failing",
      error: !io ? "Socket.IO not initialized" : "Redis not configured (needed for adapter check)",
      lastCheckedAt: new Date().toISOString(),
    });
    return;
  }

  const result = await checkSocket(io, redis);
  res.status(result.status === "failing" ? 503 : 200).json(result);
});

export default router;
