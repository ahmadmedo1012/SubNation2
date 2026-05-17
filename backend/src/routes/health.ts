import { HealthCheckResponse } from "@workspace/api-zod";
import { db as neonDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getFirebaseAdminApp, getFirebaseAdminAuth } from "../lib/firebase-admin";
import { getRedisClient } from "../lib/redis-client";
import { getIO } from "../lib/socket";

const router: IRouter = Router();

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
  version: string;
  uptimeSec: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Failure counter helpers (Redis-backed)
// ──────────────────────────────────────────────────────────────────────────────

const FAILURE_COUNTER_PREFIX = "health:fail:";
const FAILURE_WINDOW_MS = 30_000; // 30 seconds

async function getFailureCount(redis: any, checkName: string): Promise<number> {
  try {
    const key = `${FAILURE_COUNTER_PREFIX}${checkName}`;
    const value = await redis.get(key);
    return parseInt(value || "0", 10);
  } catch {
    return 0;
  }
}

async function incrementFailureCounter(redis: any, checkName: string): Promise<void> {
  try {
    const key = `${FAILURE_COUNTER_PREFIX}${checkName}`;
    await redis.incr(key);
    await redis.expire(key, Math.ceil(FAILURE_WINDOW_MS / 1000));
  } catch {
    // Silently fail - health check should not crash due to Redis issues
  }
}

async function clearFailureCounter(redis: any, checkName: string): Promise<void> {
  try {
    const key = `${FAILURE_COUNTER_PREFIX}${checkName}`;
    await redis.del(key);
  } catch {
    // Silently fail
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Health check implementations
// ──────────────────────────────────────────────────────────────────────────────

const CHECK_TIMEOUT_MS = 5000;

async function checkRedis(redis: any): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), CHECK_TIMEOUT_MS),
      ),
    ]);
    const latencyMs = Date.now() - start;

    if (result === "PONG") {
      // Reset failure counter on success
      await clearFailureCounter(redis, "redis");
      return {
        status: latencyMs > 200 ? "degraded" : "ok",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      await incrementFailureCounter(redis, "redis");
      const failures = await getFailureCount(redis, "redis");
      return {
        status: failures >= 3 ? "failing" : "degraded",
        latencyMs,
        error: `Unexpected response: ${result}`,
        lastCheckedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    await incrementFailureCounter(redis, "redis");
    const failures = await getFailureCount(redis, "redis");
    return {
      status: failures >= 3 ? "failing" : "degraded",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function checkNeon(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      neonDb.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Neon query timeout")), CHECK_TIMEOUT_MS),
      ),
    ]);
    const latencyMs = Date.now() - start;

    if (result) {
      // Reset failure counter on success — keyed by check name on Redis if available.
      const redis = getRedisClient();
      if (redis) await clearFailureCounter(redis, "neon");
      return {
        status: latencyMs > 500 ? "degraded" : "ok",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      const redis = getRedisClient();
      if (redis) await incrementFailureCounter(redis, "neon");
      const failures = redis ? await getFailureCount(redis, "neon") : 0;
      return {
        status: failures >= 2 ? "failing" : "degraded",
        latencyMs,
        error: "Query returned no result",
        lastCheckedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    const redis = getRedisClient();
    if (redis) await incrementFailureCounter(redis, "neon");
    const failures = redis ? await getFailureCount(redis, "neon") : 0;
    return {
      status: failures >= 2 ? "failing" : "degraded",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
      lastCheckedAt: new Date().toISOString(),
    };
  }
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
        setTimeout(() => reject(new Error("Worker heartbeat timeout")), CHECK_TIMEOUT_MS),
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

    // Use Redis pub/sub ping to check Socket.IO adapter reachability
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Socket.IO adapter timeout")), CHECK_TIMEOUT_MS),
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

// ──────────────────────────────────────────────────────────────────────────────
// Route handlers
// ──────────────────────────────────────────────────────────────────────────────

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Diagnostic endpoint - reports Firebase Admin initialization state without
// exposing any secrets. Use this to debug 401 issues in production.
router.get("/healthz/firebase", (_req, res) => {
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

  const app = getFirebaseAdminApp();
  const auth = getFirebaseAdminAuth();

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
router.get("/healthz/ready", async (_req, res) => {
  const redis = getRedisClient();
  const io = getIO();

  const checks: Record<string, CheckResult> = {};
  let overallStatus: CheckStatus = "ok";

  // Helper: fold one check result into overallStatus, respecting `optional`.
  const fold = (result: CheckResult) => {
    if (result.status === "failing") {
      // Optional failures cap overall at "degraded"; critical failures escalate.
      if (result.optional === true) {
        if (overallStatus === "ok") overallStatus = "degraded";
      } else {
        overallStatus = "failing";
      }
    } else if (result.status === "degraded" && overallStatus === "ok") {
      overallStatus = "degraded";
    }
  };

  // Check Redis (critical)
  if (redis) {
    const result = await checkRedis(redis);
    checks.redis = result;
    fold(result);
  } else {
    checks.redis = {
      status: "failing",
      error: "Redis not configured",
      lastCheckedAt: new Date().toISOString(),
    };
    fold(checks.redis);
  }

  // Check Neon (critical) — singleton from @workspace/db
  {
    const result = await checkNeon();
    checks.neon = result;
    fold(result);
  }

  // Check Worker (optional) — single-tier deployments are valid
  if (redis) {
    const result = await checkWorker(redis);
    checks.worker = result;
    fold(result);
  } else {
    // Without Redis we can't check worker heartbeat. Emit a degraded
    // optional result so the panel still shows the row but readiness
    // doesn't fail twice for the same root cause.
    checks.worker = {
      status: "degraded",
      optional: true,
      note: "Redis unavailable — worker heartbeat not checked",
      lastCheckedAt: new Date().toISOString(),
    };
    fold(checks.worker);
  }

  // Check Socket.IO (optional) — realtime is degraded UX, not critical path
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

  const version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "unknown";
  const uptimeSec = Math.floor(process.uptime());

  const response: HealthCheckResponseExtended = {
    status: overallStatus,
    checks,
    version,
    uptimeSec,
  };

  res.status((overallStatus as CheckStatus) === "failing" ? 503 : 200).json(response);
});

// Redis health check
router.get("/healthz/redis", async (_req, res): Promise<void> => {
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

// Neon health check
router.get("/healthz/neon", async (_req, res): Promise<void> => {
  const result = await checkNeon();
  res.status(result.status === "failing" ? 503 : 200).json(result);
});

// Worker health check
router.get("/healthz/worker", async (_req, res): Promise<void> => {
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

// Socket.IO health check
router.get("/healthz/socket", async (_req, res): Promise<void> => {
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
