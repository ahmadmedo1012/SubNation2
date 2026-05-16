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

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

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
// Worker Metrics
// ============================================================================

/**
 * Background job executions by job name and status.
 * job: job name (e.g., "order-expiry", "coupon-expiry", "low-stock-check")
 * status: "queued" | "running" | "succeeded" | "failed"
 */
export const workerJobsTotal = new Counter({
  name: "worker_jobs_total",
  help: "Total background job executions by job name and status",
  labelNames: ["job", "status"] as const,
  registers: [getRegistry()],
});

// ============================================================================
// Neon Database Metrics
// ============================================================================

/**
 * Active Neon database connections in the pool.
 */
export const neonConnectionsActive = new Gauge({
  name: "neon_connections_active",
  help: "Number of active Neon database connections in the pool",
  registers: [getRegistry()],
});

/**
 * In-flight Neon database queries.
 */
export const neonInflightQueries = new Gauge({
  name: "neon_inflight_queries",
  help: "Number of in-flight Neon database queries",
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
  labels: Record<T, string | number>,
  value?: number,
): void {
  try {
    if (value !== undefined) {
      counter.inc(labels as Record<T, string | number>, value);
    } else {
      counter.inc(labels);
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    // Log but don't throw - instrumentation failures must not crash the app
    console.error("Metric emission failed:", err);
  }
}

/**
 * Safely observe a histogram value, catching any errors.
 */
export function safeObserve<T extends string>(
  histogram: Histogram<T>,
  labels: Record<T, string | number>,
  value: number,
): void {
  try {
    histogram.observe(labels as Record<T, string | number>, value);
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    console.error("Histogram observation failed:", err);
  }
}

/**
 * Safely set a gauge value, catching any errors.
 */
export function safeSet<T extends string>(
  gauge: Gauge<T>,
  labels: Record<T, string | number> | undefined,
  value: number,
): void {
  try {
    if (labels) {
      gauge.set(labels as Record<T, string | number>, value);
    } else {
      gauge.set(value);
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    console.error("Gauge set failed:", err);
  }
}

/**
 * Safely increment a gauge, catching any errors.
 */
export function safeGaugeInc<T extends string>(
  gauge: Gauge<T>,
  labels?: Record<T, string | number>,
): void {
  try {
    if (labels) {
      gauge.inc(labels as Record<T, string | number>);
    } else {
      gauge.inc();
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    console.error("Gauge increment failed:", err);
  }
}

/**
 * Safely decrement a gauge, catching any errors.
 */
export function safeGaugeDec<T extends string>(
  gauge: Gauge<T>,
  labels?: Record<T, string | number>,
): void {
  try {
    if (labels) {
      gauge.dec(labels as Record<T, string | number>);
    } else {
      gauge.dec();
    }
  } catch (err) {
    monitoringErrorsTotal.inc({ component: "metrics" });
    console.error("Gauge decrement failed:", err);
  }
}

/**
 * Get Prometheus exposition format for all metrics.
 */
export async function getMetrics(): Promise<string> {
  return getRegistry().metrics();
}
