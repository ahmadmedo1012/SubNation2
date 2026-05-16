import { Router, type IRouter } from "express";
import { getAdminAlerts } from "../../jobs/alertLogger";
import { buildMetricsSnapshot } from "../../lib/metrics-snapshot";
import { getRedisClient } from "../../lib/redis-client";
import { getSchedulerState } from "../../lib/scheduler-state";
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

/**
 * Aggregated metrics snapshot for the admin dashboard.
 *
 * Pulls the live Prometheus registry and re-shapes it into a stable JSON
 * contract. Polled by the dashboard every ~15 s; the response is small
 * (typically <8 KB) and the registry walk is O(n) over emitted series so
 * this is safe to call on a 15 s cadence even on the free tier.
 *
 * Schema is documented at `lib/metrics-snapshot.ts → MetricsSnapshot`.
 */
router.get("/metrics", requireAdmin, async (_req, res) => {
  try {
    const snapshot = await buildMetricsSnapshot();
    res.set("Cache-Control", "no-store");
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({
      error: "metrics_snapshot_failed",
      message: err instanceof Error ? err.message : "unknown",
    });
  }
});

/**
 * Scheduler runtime state.
 *
 * Replaces the misleading "worker failed" derivation in the public health
 * check (which only looked at the Redis heartbeat key without knowing
 * whether a worker is even *expected*). Returns the actual scheduler mode
 * (embedded vs dedicated vs disabled) plus heartbeat health, so the UI
 * can render a correct "Scheduler" panel instead of "Worker failed".
 */
router.get("/scheduler", requireAdmin, async (_req, res) => {
  const state = getSchedulerState();

  // Heartbeat info from Redis (same source the public /healthz/worker uses,
  // but framed by the scheduler mode).
  const redis = getRedisClient();
  let heartbeat: {
    ageSec: number | null;
    ts: string | null;
    healthy: boolean;
  } = { ageSec: null, ts: null, healthy: false };

  if (redis) {
    try {
      const raw = await redis.get("worker:heartbeat");
      if (raw) {
        const parsed = JSON.parse(raw);
        const ts = Number(parsed.ts);
        const ageSec = Math.round((Date.now() - ts) / 1000);
        heartbeat = {
          ageSec,
          ts: new Date(ts).toISOString(),
          healthy: ageSec < 60,
        };
      }
    } catch {
      // ignore — surface as unhealthy
    }
  }

  // The "expected" interpretation depends on mode:
  //   - embedded + active   → heartbeat MUST exist and be fresh
  //   - embedded + !leader  → heartbeat exists from another process; informational only
  //   - dedicated           → heartbeat from the dedicated worker; UI shows worker pill
  //   - disabled            → no heartbeat expected; not a failure
  const heartbeatExpected =
    (state.mode === "embedded" && state.active) || state.mode === "dedicated";

  res.json({
    mode: state.mode,
    active: state.active,
    isLeader: state.isLeader,
    instanceId: state.instanceId,
    reason: state.reason,
    startedAt: state.startedAt,
    heartbeat: {
      ...heartbeat,
      expected: heartbeatExpected,
    },
    description:
      state.mode === "embedded" && state.active
        ? "الجدولة المضمّنة تعمل في عملية الخادم (لا توجد خدمة worker مستقلة)."
        : state.mode === "embedded" && !state.active
          ? "الجدولة المضمّنة لا تعمل (هذا الإصدار ليس قائد القفل) — عملية أخرى تتولى المهام."
          : state.mode === "dedicated"
            ? "الجدولة معطّلة في الخادم — يُتوقع وجود خدمة worker مستقلة."
            : "الجدولة غير نشطة.",
  });
});

export { router as adminObservabilityRouter };
