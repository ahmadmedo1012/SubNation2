/**
 * Metrics Registry for Prometheus exposition.
 * Design §4.3 - Full counter/histogram/gauge catalog.
 *
 * Satisfies: R2.1, R2.12, R2.16, R6.1
 * Guardrails:
 *   - Registry initialized exactly once (singleton pattern).
 *   - All metric increments wrapped in try/catch; failures increment monitoringErrorsTotal.
 *   - Cardinality bound: route label is Express route pattern, not resolved URL.
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "@prometheus-io/client";
import { logger } from "./logger";

/**
 * R179 — the library's (unexported) LabelValues<T> shape, mirrored.
 *
 * @prometheus-io/client 0.16.x declares label parameters as a CONDITIONAL
 * type — `T extends never ? Partial<Record<string, never>>
 * : Partial<Record<T, string | number>>` — which TypeScript cannot prove
 * assignable from a plain `Record<T, string | number>` while T is an
 * unresolved generic (the pre-rename prom-client 15.x type was the plain
 * `Partial<Record<T, string | number>>`, which is why the helpers used to
 * type-check without this mirror). Replicating the exact conditional keeps
 * the helpers assignable to every inc/observe/set call site below, and for
 * every CONCRETE metric (T = a label-name union) it still resolves to the
 * same Partial<Record<...>> the library itself accepts at its methods.
 */
export type MetricLabels<T extends string> = T extends never
  ? Partial<Record<string, never>>
  : Partial<Record<T, string | number>>;

// ============================================================================
// Singleton Registry
// ============================================================================

let _registry: Registry | null = null;

/**
 * Get the singleton Prometheus registry.
 * Initializes default Node.js process metrics on first call.
 */
export function getRegistry(): Registry {
  if (!_registry) {
    _registry = new Registry();
    // Collect default Node.js process metrics (memory, CPU, etc.)
    collectDefaultMetrics({ register: _registry });
  }
  return _registry;
}

/**
 * Convenience export for direct registry access.
 * Uses a Proxy to forward property access to the singleton registry.
 */
export const registry = new Proxy<Registry>({} as Registry, {
  get(_target, prop) {
    return Reflect.get(getRegistry(), prop);
  },
});

// ============================================================================
// HTTP Metrics
// ============================================================================

/**
 * Total HTTP requests by route, method, and status code.
 * Counter is appropriate for monotonically increasing values.
 */
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["route", "method", "status"] as const,
  registers: [getRegistry()],
});

/**
 * HTTP request duration histogram.
 * Buckets chosen to capture p50/p95/p99 for typical API latencies.
 * Design §3.1.3: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 seconds
 */
export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["route", "method", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [getRegistry()],
});

// ============================================================================
// Authentication Metrics
// ============================================================================

/**
 * Authentication outcomes by method and result.
 * method: "firebase" | "password" | "otp"
 * outcome: "success" | "failure" | "lockout"
 */
export const authOutcomesTotal = new Counter({
  name: "auth_outcomes_total",
  help: "Total authentication outcomes by method and result",
  labelNames: ["method", "outcome"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Telegram Notification Metrics
// ============================================================================

/**
 * Counts every Telegram business-notification dispatch attempt.
 *
 *   - outcome=ok       → message accepted by Telegram (HTTP 200, body.ok=true)
 *   - outcome=skip     → env not configured (TELEGRAM_BOT_TOKEN/CHAT_ID unset)
 *   - outcome=retry    → transient failure (5xx / 429); retried at least once
 *   - outcome=failure  → permanent failure after retry (4xx, network, timeout)
 *
 * `event` labels the helper that triggered the send (order_new,
 * user_new, topup_new, topup_approved, topup_rejected, coupon_maxed,
 * coupon_expiring, low_stock, diagnostic). Cardinality is bounded —
 * one cell per (event × outcome).
 *
 * Surfaces in /api/admin/observability/metrics and the admin system
 * page so operators can detect "deliveries stopped" without checking
 * Telegram itself.
 */
export const telegramSendsTotal = new Counter({
  name: "telegram_sends_total",
  help: "Total Telegram notification dispatches by event and outcome",
  labelNames: ["event", "outcome"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Boot Migration Metrics
// ============================================================================

/**
 * Boot-time schema migration outcomes.
 *
 * outcome:
 *   - "ok"          — migration ran cleanly
 *   - "idempotent"  — migration ran but a non-fatal "already exists"
 *                     style error was swallowed (legacy schema reconcile)
 *   - "skipped_lock"— another instance already running migrations (fine)
 *   - "skipped_disabled" — DISABLE_BOOT_MIGRATIONS=true (operator override)
 *   - "critical"    — migration failed with a real schema-corrupting
 *                     error; production process should refuse to start
 */
export const migrationsRunsTotal = new Counter({
  name: "migrations_runs_total",
  help: "Total boot-time schema migration runs by outcome",
  labelNames: ["outcome"] as const,
  registers: [getRegistry()],
});

/**
 * Boot-time schema migration duration in seconds.
 *
 * Buckets cover sub-100 ms (already-up-to-date schema) through 30+ s
 * (large migration on cold cache). Useful for tracking schema-drift
 * accumulation: migrations should normally take < 1 s once the
 * database is in sync.
 */
export const migrationDurationSeconds = new Histogram({
  name: "migration_duration_seconds",
  help: "Boot-time schema migration duration in seconds",
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [getRegistry()],
});

/**
 * Body-parser recovery outcomes.
 *
 * reason:
 *   - "salvaged_urlencoded" — client sent form-urlencoded body with
 *                             wrong Content-Type (application/json);
 *                             we recovered via URLSearchParams.
 *   - "invalid_json"        — body could not be parsed as JSON or as
 *                             URL-encoded; returned clean 400.
 *
 * Volume here tracks bot-probe traffic + legitimate client
 * misconfigurations. Visible on /admin/system observability surface.
 */
export const bodyParseErrorsTotal = new Counter({
  name: "body_parse_errors_total",
  help: "Total body-parser error-recovery events by reason",
  labelNames: ["reason"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Redis Metrics
// ============================================================================

/**
 * Redis operations by type and status.
 * op: "get" | "set" | "del" | "ping" | "incr" | "expire" | "lpush" | "rpop" | etc.
 * status: "success" | "error"
 */
export const redisOpsTotal = new Counter({
  name: "redis_ops_total",
  help: "Total Redis operations by type and status",
  labelNames: ["op", "status"] as const,
  registers: [getRegistry()],
});

/**
 * Redis errors by reason.
 * reason: "connection" | "timeout" | "command" | "memory" | etc.
 */
export const redisErrorsTotal = new Counter({
  name: "redis_errors_total",
  help: "Total Redis errors by reason",
  labelNames: ["reason"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Socket.IO Metrics
// ============================================================================

/**
 * Currently connected Socket.IO clients.
 * Gauge is appropriate for values that can go up or down.
 */
export const socketConnectedClients = new Gauge({
  name: "socket_connected_clients",
  help: "Number of currently connected Socket.IO clients",
  registers: [getRegistry()],
});

/**
 * Socket.IO events by name and direction.
 * event: event name (e.g., "message", "notification", "order:update")
 * direction: "inbound" | "outbound"
 */
export const socketEventsTotal = new Counter({
  name: "socket_events_total",
  help: "Total Socket.IO events by name and direction",
  labelNames: ["event", "direction"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Worker / Jobs Metrics
// ============================================================================

/**
 * Background job executions by job and status.
 *
 * R186 (I-F2 + F-F3): the counter was read everywhere (metrics-snapshot
 * "worker" block → the admin system page's background-jobs panel) but
 * never registered or incremented — the panel showed its empty state
 * forever. job mirrors the per-job Sentry tag each scheduler catch
 * already uses; status is "success" | "failure".
 */
export const workerJobsTotal = new Counter({
  name: "worker_jobs_total",
  help: "Background job executions by job and status",
  labelNames: ["job", "status"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Neon Database Metrics
// ============================================================================

/**
 * Neon pool-level errors (DNS, TLS, auth, peer reset — NOT single query
 * failures). Rare and critical: each increment should page someone.
 *
 * Incremented by the pool 'error' listener in db-instrumentation.ts and
 * read by the `neon_connection_failure` alert rule. Previously that rule
 * (wrongly) read `redis_errors_total` — a copy-paste that meant genuine
 * Neon outages never fired an alert.
 */
export const neonPoolErrorsTotal = new Counter({
  name: "neon_pool_errors_total",
  help: "Total Neon connection-pool level errors (DNS/TLS/auth/reset)",
  registers: [getRegistry()],
});

// ============================================================================
// Durable Idempotency Metrics
// ============================================================================

/**
 * R135 (BE-1, repo audit #9): durable idempotency guard degradation state.
 *
 * 1 while lib/idempotency.ts's SQLSTATE 42P01 latch is set (the
 * idempotency_keys backing table is missing — the durable purchase-dedup
 * backstop is a no-op until the table returns or the process restarts),
 * 0 when the guard is armed. Before this gauge a table dropped
 * mid-process silently disabled the money-path dedup with no observable
 * signal; /api/metrics + the admin observability surfaces now carry it,
 * and the hourly re-probe in idempotency.ts flips it back to 0 the
 * moment the table answers again.
 */
export const idempotencyDegraded = new Gauge({
  name: "idempotency_degraded",
  help: "1 when the durable idempotency guard is degraded (idempotency_keys table missing), 0 when armed",
  registers: [getRegistry()],
});

// ============================================================================
// Core Web Vitals Metrics
// ============================================================================

/**
 * CWV samples received by metric name, route, and viewport.
 * name: "lcp" | "fcp" | "inp" | "cls" | "ttfb"
 * route: frontend route path
 * viewport: "mobile" | "desktop"
 */
export const cwvSamplesTotal = new Counter({
  name: "cwv_samples_total",
  help: "Total Core Web Vitals samples received",
  labelNames: ["name", "route", "viewport"] as const,
  registers: [getRegistry()],
});

/**
 * CWV sample values histogram.
 * Separate buckets per metric type are handled at observation time:
 * - LCP/FCP: 100, 300, 800, 1200, 1800, 2500, 4000, 6000 ms
 * - INP: 50, 100, 200, 300, 500, 1000 ms
 * - CLS: 0.01, 0.05, 0.1, 0.25, 0.5, 1.0 (unitless)
 * - TTFB: same as LCP/FCP
 *
 * We use a superset of buckets that covers all CWV metrics.
 * Values are in milliseconds for time-based metrics, unitless for CLS.
 */
export const cwvSampleValue = new Histogram({
  name: "cwv_sample_value",
  help: "Core Web Vitals sample values",
  labelNames: ["name", "route", "viewport"] as const,
  // Superset buckets covering all CWV metrics (in milliseconds for time-based)
  buckets: [
    0.01, 0.05, 0.1, 0.25, 0.5, 1, 50, 100, 200, 300, 500, 800, 1000, 1200, 1800, 2500, 4000, 6000,
  ],
  registers: [getRegistry()],
});

// ============================================================================
// Monitoring Health Metrics
// ============================================================================

/**
 * Monitoring instrumentation errors by component.
 * Incremented when any instrumentation (metrics, logging, tracing) fails.
 * component: "metrics" | "logger" | "sentry" | "correlation" | "worker-heartbeat"
 */
export const monitoringErrorsTotal = new Counter({
  name: "monitoring_errors_total",
  help: "Total monitoring instrumentation errors by component",
  labelNames: ["component"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Alerting Metrics
// ============================================================================

/**
 * Alert dispatches by rule, severity, channel, and outcome.
 * rule: alert rule name (e.g., "api-5xx-rate", "auth-failure-rate")
 * severity: "info" | "warning" | "critical"
 * channel: "telegram" | "discord" | "webhook"
 * outcome: "delivered" | "deduped" | "rate-limited" | "failed"
 */
export const alertsDispatchedTotal = new Counter({
  name: "alerts_dispatched_total",
  help: "Total alert dispatches by rule, severity, channel, and outcome",
  labelNames: ["rule", "severity", "channel", "outcome"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely increment a counter, catching any errors.
 * Per design §3.1.3: failures increment monitoringErrorsTotal instead of propagating.
 */
export function safeInc<T extends string>(
  counter: Counter<T>,
  labels: MetricLabels<T>,
  value?: number,
): void {
  try {
    if (value !== undefined) {
      counter.inc(labels, value);
    } else {
      counter.inc(labels);
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    // Log but don't throw - instrumentation failures must not crash the app
    logger.error({ err, component: "metrics" }, "Metric emission failed");
  }
}

/**
 * Safely observe a histogram value, catching any errors.
 *
 * R179: two overloads because @prometheus-io/client 0.16.x resolves
 * LabelValues<never> to `never` — for a labelless histogram the ONLY
 * legal call shape is observe(value); the old prom-client 15.x accepted
 * observe({}, value) (its non-conditional LabelValues<never> was `{}`),
 * which is why the labelless overload now exists as a distinct shape.
 */
export function safeObserve(histogram: Histogram<never>, value: number): void;
export function safeObserve<T extends string>(
  histogram: Histogram<T>,
  labels: MetricLabels<T>,
  value: number,
): void;
export function safeObserve<T extends string>(
  histogram: Histogram<T> | Histogram<never>,
  labelsOrValue: MetricLabels<T> | number,
  maybeValue?: number,
): void {
  try {
    if (typeof labelsOrValue === "number") {
      (histogram as Histogram<never>).observe(labelsOrValue);
    } else {
      (histogram as Histogram<T>).observe(labelsOrValue, maybeValue as number);
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    logger.error({ err, component: "metrics" }, "Histogram observation failed");
  }
}

/**
 * Safely increment a gauge, catching any errors.
 */
export function safeGaugeInc<T extends string>(gauge: Gauge<T>, labels?: MetricLabels<T>): void {
  try {
    if (labels) {
      gauge.inc(labels);
    } else {
      gauge.inc();
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    logger.error({ err, component: "metrics" }, "Gauge increment failed");
  }
}

/**
 * Safely decrement a gauge, catching any errors.
 */
export function safeGaugeDec<T extends string>(gauge: Gauge<T>, labels?: MetricLabels<T>): void {
  try {
    if (labels) {
      gauge.dec(labels);
    } else {
      gauge.dec();
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    logger.error({ err, component: "metrics" }, "Gauge decrement failed");
  }
}

/**
 * Safely set a gauge to an absolute value, catching any errors.
 *
 * R135 (BE-1): the gauge.set() counterpart of safeGaugeInc/safeGaugeDec —
 * the 0/1 state gauges (idempotency_degraded) are written from the
 * money path's error handling, where an instrumentation failure must
 * never mask the original error.
 */
export function safeGaugeSet<T extends string>(
  gauge: Gauge<T>,
  value: number,
  labels?: MetricLabels<T>,
): void {
  try {
    if (labels) {
      gauge.set(labels, value);
    } else {
      gauge.set(value);
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    logger.error({ err, component: "metrics" }, "Gauge set failed");
  }
}

/**
 * Get Prometheus exposition format for all metrics.
 */
export async function getMetrics(): Promise<string> {
  return getRegistry().metrics();
}
