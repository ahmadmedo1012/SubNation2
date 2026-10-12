import { HealthCheckResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getFirebaseAdminApp, getFirebaseAdminAuth } from "../lib/firebase-admin";
import { getRedisClient } from "../lib/redis-client";
import { getIO } from "../lib/socket";
import { requireAdmin } from "../middlewares/requireAdmin";
// R122 (A5-P2): the deep /healthz/* diagnostic subroutes leak deployment
// config shape (Firebase project id, service-account parseability, Redis/
// Neon latency + error text, scheduler topology) — the same sensitivity
// class as their /api/admin/diagnostics + /api/admin/observability twins,
// which are mounted under requirePermission("settings")
// (routes/admin/index.ts:123-125). requireAdmin alone let ANY scoped
// admin (e.g. a support-only operator) read them; the settings scope now
// matches the twins AND the admin UI, which gates the /admin/system page
// (the only frontend consumer of /healthz/ready) behind scope "settings"
// (pages/admin/layout.tsx). /healthz, /healthz/live and /healthz/summary
// stay PUBLIC — they are the compose/Coolify healthcheck + public status
// probes (docs/operations/FINAL_MONITORING.md) and carry no detail.
import { requirePermission } from "../lib/permissions";
// R136 (BE-3 extraction): the health-check service moved verbatim to
// services/health-checks.service.ts (failure counters, per-subsystem
// probes, the bounded readiness aggregate + cache). This file keeps only
// the thin route handlers. The re-export block below keeps the module's
// export surface byte-stable — tests/health-neon-fallback.test.ts and
// routes/__tests__/health-{summary-wedge,neon-warmup}.test.ts import
// these seams from THIS module and stay green unedited.
import {
  checkRedis,
  checkNeon,
  checkWorker,
  checkSocket,
  getReadyState,
  type CheckStatus,
} from "../services/health-checks.service";

export {
  checkNeonWith,
  computeReadyState,
  resetNeonFailureStreakForTests,
  resetReadyStateForTests,
} from "../services/health-checks.service";

const router: IRouter = Router();

// ──────────────────────────────────────────────────────────────────────────────
// Route handlers
// ──────────────────────────────────────────────────────────────────────────────

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // R117 (A4-P8): family consistency — /healthz/live sends
  // `public, max-age=5` and /healthz/summary `max-age=15`, but the base
  // probe sent nothing (only an etag), so intermediate caches were free
  // to apply their own freshness heuristics to a liveness probe.
  res.setHeader("Cache-Control", "public, max-age=5");
  res.json(data);
});

// Diagnostic endpoint — admin-gated. Leaks deployment config (Firebase
// project id, service-account-JSON shape, env presence) so MUST NOT be
// exposed to public users. R122 (A5-P2): settings-scoped like the
// /admin/diagnostics twins (see the import block comment).
router.get("/healthz/firebase", requireAdmin, requirePermission("settings"), async (_req, res) => {
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
//
// IMPORTANT: This endpoint is admin-gated (`requireAdmin`). The full
// per-check breakdown exposes infrastructure details that are not
// safe to surface to public users. The public-safe surface is
// `/api/healthz/summary` which returns only the status discriminator.
// (Status escalation rules live with computeReadyState in
// services/health-checks.service.ts.)
router.get("/healthz/ready", requireAdmin, requirePermission("settings"), async (_req, res) => {
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
// publicly. The public surface is /healthz/summary. R122 (A5-P2):
// settings-scoped like the /admin/diagnostics twins (see the import block
// comment in this file).
router.get(
  "/healthz/redis",
  requireAdmin,
  requirePermission("settings"),
  async (_req, res): Promise<void> => {
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
  },
);

router.get(
  "/healthz/neon",
  requireAdmin,
  requirePermission("settings"),
  async (_req, res): Promise<void> => {
    const result = await checkNeon();
    res.status(result.status === "failing" ? 503 : 200).json(result);
  },
);

router.get(
  "/healthz/worker",
  requireAdmin,
  requirePermission("settings"),
  async (_req, res): Promise<void> => {
    const redis = getRedisClient();

    if (!redis) {
      if (!process.env.REDIS_URL) {
        // R110-E (109-k P3-2): REDIS_URL unset is the DESIGNED single-instance
        // shape (see the aggregate branch in
        // services/health-checks.service.ts). The worker heartbeat only
        // exists in the multi-instance topology — the honest answer for an
        // operator here is "healthy, not applicable", not a 503 that reads
        // like an outage.
        res.status(200).json({
          status: "ok",
          optional: true,
          note: "not configured — single-instance, no-Redis by design (worker heartbeat requires Redis)",
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }
      res.status(503).json({
        status: "failing",
        error: "Redis configured but unavailable (needed for worker heartbeat check)",
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    const result = await checkWorker(redis);
    res.status(result.status === "failing" ? 503 : 200).json(result);
  },
);

router.get(
  "/healthz/socket",
  requireAdmin,
  requirePermission("settings"),
  async (_req, res): Promise<void> => {
    const io = getIO();
    const redis = getRedisClient();

    if (!io || !redis) {
      if (!process.env.REDIS_URL) {
        // R110-E (109-k P3-2): same designed-shape honesty as /healthz/worker
        // above — without Redis, Socket.IO runs on its in-memory adapter, which
        // is the only correct topology for a single instance.
        res.status(200).json({
          status: "ok",
          optional: true,
          note: "not configured — single-instance, no-Redis by design (Socket.IO uses the in-memory adapter)",
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }
      res.status(503).json({
        status: "failing",
        error: !io
          ? "Socket.IO not initialized"
          : "Redis configured but unavailable (needed for adapter check)",
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    const result = await checkSocket(io, redis);
    res.status(result.status === "failing" ? 503 : 200).json(result);
  },
);

export default router;
