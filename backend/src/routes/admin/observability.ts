import { Router, type IRouter } from "express";
import { getAdminAlerts } from "../../jobs/alertLogger";
import { getRedisClient } from "../../lib/redis-client";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router: IRouter = Router();

const SENTRY_DASHBOARD_URL = process.env.SENTRY_DASHBOARD_URL ?? null;
const RENDER_DASHBOARD_URL = process.env.RENDER_DASHBOARD_URL ?? null;
const NEON_DASHBOARD_URL = process.env.NEON_DASHBOARD_URL ?? null;

/**
 * Cached value with last-known-good timestamp for graceful degradation.
 */
class CachedValue<T> {
  private value: T | null = null;
  private builtAt: number = 0;
  private lastKnownGoodAt: number = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly compute: () => Promise<T>,
  ) {}

  async get(): Promise<{ value: T | null; lastKnownGoodAt: string | null; stale: boolean }> {
    const now = Date.now();
    if (this.value !== null && now - this.builtAt < this.ttlMs) {
      return {
        value: this.value,
        lastKnownGoodAt: new Date(this.lastKnownGoodAt).toISOString(),
        stale: false,
      };
    }
    try {
      const v = await this.compute();
      this.value = v;
      this.builtAt = now;
      this.lastKnownGoodAt = now;
      return {
        value: v,
        lastKnownGoodAt: new Date(this.lastKnownGoodAt).toISOString(),
        stale: false,
      };
    } catch {
      // Return last-known-good with stale flag
      return {
        value: this.value,
        lastKnownGoodAt: this.lastKnownGoodAt ? new Date(this.lastKnownGoodAt).toISOString() : null,
        stale: true,
      };
    }
  }
}

const recentAlertsCache = new CachedValue(60_000, async () => getAdminAlerts(50));

router.get("/summary", requireAdmin, async (_req, res) => {
  const [alerts] = await Promise.all([recentAlertsCache.get()]);

  const redis = getRedisClient();
  let workerHeartbeat: { ageSec: number | null; ts: string | null } | null = null;
  if (redis) {
    try {
      const raw = await redis.get("worker:heartbeat");
      if (raw) {
        const parsed = JSON.parse(raw);
        workerHeartbeat = {
          ageSec: Math.round((Date.now() - Number(parsed.ts)) / 1000),
          ts: new Date(Number(parsed.ts)).toISOString(),
        };
      }
    } catch {
      // ignore — surface as null
    }
  }

  res.json({
    server: {
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "unknown",
      uptimeSec: Math.floor(process.uptime()),
      nodeVersion: process.version,
    },
    redis: { available: redis !== null },
    worker: { heartbeat: workerHeartbeat },
    alerts: {
      lastKnownGoodAt: alerts.lastKnownGoodAt,
      stale: alerts.stale,
      recentCount: alerts.value?.length ?? 0,
    },
    dashboards: {
      render: RENDER_DASHBOARD_URL,
      sentry: SENTRY_DASHBOARD_URL,
      neon: NEON_DASHBOARD_URL,
    },
  });
});

router.get("/alerts/recent", requireAdmin, async (_req, res) => {
  const cached = await recentAlertsCache.get();
  res.json({
    alerts: cached.value ?? [],
    lastKnownGoodAt: cached.lastKnownGoodAt,
    stale: cached.stale,
  });
});

/**
 * Deploys feed. The Phase 1 master-execution-plan calls for a Render_MCP
 * proxy here, but the MCP must be invoked from a privileged backend with the
 * Render API key. Until that key is provisioned, return an empty list with
 * `pendingMcpProxy:true` so the dashboard widget can render a friendly
 * placeholder.
 */
router.get("/deploys/recent", requireAdmin, (_req, res) => {
  res.json({
    deploys: [],
    pendingMcpProxy: true,
    note: "Render_MCP proxy not yet wired — provision RENDER_API_KEY and replace this stub with a list_deploys call.",
    lastKnownGoodAt: null,
    stale: false,
  });
});

router.get("/sentry/summary", requireAdmin, (_req, res) => {
  res.json({
    pending: !process.env.SENTRY_AUTH_TOKEN,
    note: !process.env.SENTRY_AUTH_TOKEN
      ? "SENTRY_AUTH_TOKEN not provisioned — once set, this endpoint will proxy Sentry's project issues API."
      : "OK",
    sentryDashboardUrl: SENTRY_DASHBOARD_URL,
    lastKnownGoodAt: null,
    stale: false,
  });
});

export { router as adminObservabilityRouter };
