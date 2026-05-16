/**
 * Convert the live Prometheus registry into a JSON snapshot the admin
 * dashboard can consume. Pure data transformation — no side effects.
 *
 * Histogram percentiles are estimated by linear interpolation across the
 * cumulative bucket counts (same algorithm Prometheus uses for the
 * `histogram_quantile()` function). The accuracy depends on the bucket
 * boundaries chosen at metric definition time — see `lib/metrics.ts` for
 * the catalog.
 *
 * Cardinality bound: we re-aggregate `httpRequestsTotal` to compute the
 * top-N routes by request count without ever touching the raw label
 * cardinality. Same with auth / redis / socket — output keys are
 * `${labelA}:${labelB}` joined strings so the JSON is grep-friendly but
 * still bounded.
 */

import { getRegistry } from "./metrics";
import { isRedisConnected } from "./redis-client";
import { getSchedulerState } from "./scheduler-state";

type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "other";

export interface RouteStat {
  route: string;
  method: string;
  count: number;
  errorCount: number;
  p95Ms: number | null;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptimeSec: number;

  http: {
    totalRequests: number;
    requestsByStatusClass: Record<StatusClass, number>;
    errorRate: number; // 5xx / total, 0–1
    latency: {
      p50Ms: number | null;
      p95Ms: number | null;
      p99Ms: number | null;
      meanMs: number | null;
    };
    topRoutes: RouteStat[];
  };

  auth: {
    outcomes: Record<string, number>; // "method:outcome" -> count
    totalAttempts: number;
    failureRate: number;
  };

  redis: {
    available: boolean;
    opsTotal: Record<string, number>; // "op:status" -> count
    errorsTotal: Record<string, number>; // reason -> count
    pingLatencyMs: { p50: number | null; p95: number | null; p99: number | null };
    degradedEvents: number;
  };

  socket: {
    connectedClients: number;
    eventsTotal: Record<string, number>; // "event:direction" -> count
  };

  worker: {
    jobsTotal: Record<string, number>; // "job:status" -> count
  };

  cwv: {
    samples: Record<string, number>; // metric name -> sample count
    p75: Record<string, number | null>; // metric name -> p75 (ms for time, unit-less for cls)
  };

  alerts: {
    dispatchedTotal: Record<string, number>; // "rule:severity:outcome" -> count
  };

  monitoringErrors: number;

  scheduler: ReturnType<typeof getSchedulerState>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Linear-interpolation quantile across cumulative histogram buckets.
 * Returns null when the histogram has zero observations.
 *
 * @param buckets Array of {le, value} where `value` is the CUMULATIVE
 *                count of observations <= `le`. Must include the +Inf
 *                terminal bucket (encoded as le=Infinity in prom-client).
 * @param q       Quantile in (0, 1].
 */
function estimateQuantile(
  buckets: Array<{ le: number; value: number }>,
  q: number,
): number | null {
  if (buckets.length === 0) return null;
  const total = buckets[buckets.length - 1].value;
  if (total === 0) return null;
  const target = total * q;

  let prevLe = 0;
  let prevCount = 0;
  for (const b of buckets) {
    if (b.value >= target) {
      // If we're in the +Inf terminal bucket, the actual value is unknown;
      // return the previous finite upper bound rather than Infinity.
      if (!Number.isFinite(b.le)) {
        return Number.isFinite(prevLe) ? prevLe : null;
      }
      const span = b.value - prevCount;
      if (span <= 0) return b.le;
      const fraction = (target - prevCount) / span;
      return prevLe + fraction * (b.le - prevLe);
    }
    prevLe = b.le;
    prevCount = b.value;
  }
  // Should never reach here (target ≤ total ≤ last bucket value), but be safe.
  const last = buckets[buckets.length - 1];
  return Number.isFinite(last.le) ? last.le : prevLe;
}

interface RawValue {
  labels: Record<string, string>;
  value: number;
}

interface RawBucket {
  labels: Record<string, string>;
  bucket?: number; // bucket upper bound (le)
  value: number;
  exemplar?: unknown;
}

interface RawMetric {
  name: string;
  type: string;
  values: Array<RawValue | RawBucket>;
}

function findMetric(metrics: RawMetric[], name: string): RawMetric | undefined {
  return metrics.find((m) => m.name === name);
}

function statusClass(code: string | number): StatusClass {
  const n = typeof code === "string" ? parseInt(code, 10) : code;
  if (!Number.isFinite(n)) return "other";
  if (n >= 200 && n < 300) return "2xx";
  if (n >= 300 && n < 400) return "3xx";
  if (n >= 400 && n < 500) return "4xx";
  if (n >= 500 && n < 600) return "5xx";
  return "other";
}

/**
 * Group histogram values by the non-`le` labels and return cumulative
 * buckets sorted by `le` ascending. The `_count` and `_sum` series for
 * the same group are merged into the same key alongside the buckets.
 */
function groupHistogramByLabels(
  rawValues: Array<RawBucket | RawValue>,
  ignoreLabels = ["le"],
): Map<string, { buckets: Array<{ le: number; value: number }>; count: number; sum: number }> {
  const out = new Map<
    string,
    { buckets: Array<{ le: number; value: number }>; count: number; sum: number }
  >();
  for (const raw of rawValues) {
    const labels = { ...raw.labels };
    for (const k of ignoreLabels) delete labels[k];
    const key = Object.keys(labels)
      .sort()
      .map((k) => `${k}=${labels[k]}`)
      .join("|");

    let entry = out.get(key);
    if (!entry) {
      entry = { buckets: [], count: 0, sum: 0 };
      out.set(key, entry);
    }
    // prom-client emits histograms as: per-bucket rows + `_count` + `_sum`.
    // The metricName field on each row tells us which (only available in
    // newer prom-client). Detect via presence of `le` label or numeric metric
    // name suffix.
    const sourceName = (raw as RawBucket & { metricName?: string }).metricName;
    if (sourceName?.endsWith("_count")) {
      entry.count = raw.value;
    } else if (sourceName?.endsWith("_sum")) {
      entry.sum = raw.value;
    } else if ("le" in raw.labels || (raw as RawBucket).bucket !== undefined) {
      const le =
        (raw as RawBucket).bucket ?? Number(raw.labels.le ?? Number.POSITIVE_INFINITY);
      entry.buckets.push({ le, value: raw.value });
    } else if (raw.labels.le === undefined) {
      // Counter-shaped value without a bucket — likely the implicit count.
      entry.count = Math.max(entry.count, raw.value);
    }
  }
  // Sort each group's buckets ascending so estimateQuantile works.
  for (const v of out.values()) {
    v.buckets.sort((a, b) => a.le - b.le);
  }
  return out;
}

function toRecord(values: Array<RawValue | RawBucket>, keyFields: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    if ("bucket" in v && v.bucket !== undefined) continue; // skip histogram buckets
    if ("le" in v.labels) continue; // skip histogram buckets via label
    const key = keyFields
      .map((f) => v.labels[f] ?? "?")
      .join(":");
    out[key] = (out[key] ?? 0) + v.value;
  }
  return out;
}

function sumValues(values: Array<RawValue | RawBucket>): number {
  let total = 0;
  for (const v of values) {
    if ("le" in v.labels) continue;
    if ("bucket" in v && v.bucket !== undefined) continue;
    total += v.value;
  }
  return total;
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function buildMetricsSnapshot(): Promise<MetricsSnapshot> {
  const registry = getRegistry();
  // getMetricsAsJSON returns one entry per metric, with all values.
  const metrics = (await registry.getMetricsAsJSON()) as unknown as RawMetric[];

  // ── HTTP ──
  const httpReq = findMetric(metrics, "http_requests_total");
  const httpDur = findMetric(metrics, "http_request_duration_seconds");

  const requestsByStatusClass: Record<StatusClass, number> = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0,
  };
  let totalRequests = 0;
  // Per-route aggregation
  const routeAgg = new Map<
    string,
    { route: string; method: string; count: number; errorCount: number }
  >();
  if (httpReq) {
    for (const v of httpReq.values) {
      if ("bucket" in v && v.bucket !== undefined) continue;
      const cls = statusClass(v.labels.status ?? "0");
      requestsByStatusClass[cls] += v.value;
      totalRequests += v.value;
      const route = v.labels.route ?? "?";
      const method = v.labels.method ?? "?";
      const k = `${method} ${route}`;
      const existing = routeAgg.get(k) ?? { route, method, count: 0, errorCount: 0 };
      existing.count += v.value;
      if (cls === "5xx" || cls === "4xx") existing.errorCount += v.value;
      routeAgg.set(k, existing);
    }
  }
  const errorRate = totalRequests === 0 ? 0 : requestsByStatusClass["5xx"] / totalRequests;

  // Latency percentiles across all routes (overall p50/p95/p99)
  let p50Ms: number | null = null;
  let p95Ms: number | null = null;
  let p99Ms: number | null = null;
  let meanMs: number | null = null;
  if (httpDur) {
    // Aggregate the histogram across all routes by summing per-bucket counts
    // grouped only by `le`. We rebuild a single cumulative-histogram view.
    const totalBuckets = new Map<number, number>();
    let totalCount = 0;
    let totalSum = 0;
    for (const raw of httpDur.values as RawBucket[]) {
      const sourceName = (raw as RawBucket & { metricName?: string }).metricName ?? "";
      if (sourceName.endsWith("_count")) {
        totalCount += raw.value;
        continue;
      }
      if (sourceName.endsWith("_sum")) {
        totalSum += raw.value;
        continue;
      }
      const le =
        raw.bucket ?? Number(raw.labels.le ?? Number.POSITIVE_INFINITY);
      totalBuckets.set(le, (totalBuckets.get(le) ?? 0) + raw.value);
    }
    const buckets = Array.from(totalBuckets.entries())
      .map(([le, value]) => ({ le, value }))
      .sort((a, b) => a.le - b.le);
    const p50 = estimateQuantile(buckets, 0.5);
    const p95 = estimateQuantile(buckets, 0.95);
    const p99 = estimateQuantile(buckets, 0.99);
    p50Ms = p50 === null ? null : p50 * 1000;
    p95Ms = p95 === null ? null : p95 * 1000;
    p99Ms = p99 === null ? null : p99 * 1000;
    meanMs = totalCount === 0 ? null : (totalSum / totalCount) * 1000;
  }

  // Top routes by request count (limit 8)
  const topRoutes: RouteStat[] = Array.from(routeAgg.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((r) => ({ ...r, p95Ms: null })); // per-route p95 omitted to keep snapshot bounded

  // ── Auth ──
  const authOutcomes = findMetric(metrics, "auth_outcomes_total");
  const authOutcomesRecord = authOutcomes ? toRecord(authOutcomes.values, ["method", "outcome"]) : {};
  const authTotal = Object.values(authOutcomesRecord).reduce((a, b) => a + b, 0);
  const authFailure = Object.entries(authOutcomesRecord)
    .filter(([k]) => k.endsWith(":failure") || k.endsWith(":lockout"))
    .reduce((a, [, v]) => a + v, 0);
  const authFailureRate = authTotal === 0 ? 0 : authFailure / authTotal;

  // ── Redis ──
  const redisOps = findMetric(metrics, "redis_ops_total");
  const redisErrors = findMetric(metrics, "redis_errors_total");
  const redisDegraded = findMetric(metrics, "redis_degraded_mode_total");
  const redisPing = findMetric(metrics, "redis_ping_latency_seconds");

  let pingP50: number | null = null;
  let pingP95: number | null = null;
  let pingP99: number | null = null;
  if (redisPing) {
    const groups = groupHistogramByLabels(redisPing.values, ["le"]);
    // No labels on this histogram, so there's a single group keyed by "".
    const group = groups.get("") ?? Array.from(groups.values())[0];
    if (group) {
      const p50 = estimateQuantile(group.buckets, 0.5);
      const p95 = estimateQuantile(group.buckets, 0.95);
      const p99 = estimateQuantile(group.buckets, 0.99);
      pingP50 = p50 === null ? null : p50 * 1000;
      pingP95 = p95 === null ? null : p95 * 1000;
      pingP99 = p99 === null ? null : p99 * 1000;
    }
  }

  // ── Socket.IO ──
  const socketClients = findMetric(metrics, "socket_connected_clients");
  const socketEvents = findMetric(metrics, "socket_events_total");
  const connectedClients = socketClients ? sumValues(socketClients.values) : 0;

  // ── Worker / Jobs ──
  const workerJobs = findMetric(metrics, "worker_jobs_total");

  // ── CWV ──
  const cwvSamples = findMetric(metrics, "cwv_samples_total");
  const cwvByName: Record<string, number> = {};
  if (cwvSamples) {
    for (const v of cwvSamples.values) {
      if ("le" in v.labels) continue;
      const name = v.labels.name ?? "?";
      cwvByName[name] = (cwvByName[name] ?? 0) + v.value;
    }
  }

  // CWV p75 — aggregate cwv_sample_value histogram across all
  // routes/viewports, grouped by `name`. p75 is the standard CWV
  // reporting percentile (Google's "Good" thresholds are p75-based).
  const cwvSampleValue = findMetric(metrics, "cwv_sample_value");
  const cwvP75: Record<string, number | null> = {};
  if (cwvSampleValue) {
    const byName = new Map<string, Map<number, number>>();
    for (const raw of cwvSampleValue.values as RawBucket[]) {
      const sourceName = (raw as RawBucket & { metricName?: string }).metricName ?? "";
      if (sourceName.endsWith("_count") || sourceName.endsWith("_sum")) continue;
      const name = raw.labels.name ?? "?";
      const le = raw.bucket ?? Number(raw.labels.le ?? Number.POSITIVE_INFINITY);
      let buckets = byName.get(name);
      if (!buckets) {
        buckets = new Map();
        byName.set(name, buckets);
      }
      buckets.set(le, (buckets.get(le) ?? 0) + raw.value);
    }
    for (const [name, bucketMap] of byName.entries()) {
      const sorted = Array.from(bucketMap.entries())
        .map(([le, value]) => ({ le, value }))
        .sort((a, b) => a.le - b.le);
      cwvP75[name] = estimateQuantile(sorted, 0.75);
    }
  }

  // ── Alerts ──
  const alertsDispatched = findMetric(metrics, "alerts_dispatched_total");
  const alertsRecord = alertsDispatched
    ? toRecord(alertsDispatched.values, ["rule", "severity", "outcome"])
    : {};

  // ── Monitoring errors ──
  const monErrors = findMetric(metrics, "monitoring_errors_total");
  const monitoringErrors = monErrors ? sumValues(monErrors.values) : 0;

  return {
    timestamp: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),

    http: {
      totalRequests,
      requestsByStatusClass,
      errorRate,
      latency: { p50Ms, p95Ms, p99Ms, meanMs },
      topRoutes,
    },

    auth: {
      outcomes: authOutcomesRecord,
      totalAttempts: authTotal,
      failureRate: authFailureRate,
    },

    redis: {
      available: isRedisConnected(),
      opsTotal: redisOps ? toRecord(redisOps.values, ["op", "status"]) : {},
      errorsTotal: redisErrors ? toRecord(redisErrors.values, ["reason"]) : {},
      pingLatencyMs: { p50: pingP50, p95: pingP95, p99: pingP99 },
      degradedEvents: redisDegraded ? sumValues(redisDegraded.values) : 0,
    },

    socket: {
      connectedClients,
      eventsTotal: socketEvents ? toRecord(socketEvents.values, ["event", "direction"]) : {},
    },

    worker: {
      jobsTotal: workerJobs ? toRecord(workerJobs.values, ["job", "status"]) : {},
    },

    cwv: { samples: cwvByName, p75: cwvP75 },

    alerts: { dispatchedTotal: alertsRecord },

    monitoringErrors,

    scheduler: getSchedulerState(),
  };
}
