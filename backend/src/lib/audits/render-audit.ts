/**
 * Render_MCP Phase 1 audit module.
 *
 * Spec:    `.kiro/specs/observability-seo-cwv-maturity/`
 *   - Requirements: R1.2, R10.1
 *   - Design:       §3.1.16 (`InspectionReport`, `McpInvocationRecord`)
 *   - Tasks:        2.1 (services + deploys) and 2.2 (logs + key-value + metrics)
 *   - Properties:   22 — every MCP invocation produces exactly one
 *                       `McpInvocationRecord`
 *
 * Scope of this file (task 2.2):
 *   • Drives Render_MCP `list_logs` (web service, last 1 h),
 *     `list_key_value` (Redis instance), and `get_metrics`
 *     (CPU / memory / request count, last 24 h).
 *   • Routes every call through `McpInvocationRecorder.invoke` so the
 *     recorder appends one `McpInvocationRecord` per call.
 *   • Returns a `RenderPhase22Findings` summary that downstream Phase 1
 *     consumers (`inspection-report.md` emitter, Memory_MCP baseline
 *     persister) can consult without re-issuing the network calls.
 *
 * This module is *additive* — it does not mutate the inspection runner
 * itself, the Express app, or any production code path. The MCP transport
 * is injected via `RenderAuditClient`, which keeps the module testable in
 * isolation and avoids hard-coding any particular MCP host.
 */

import type { McpInvocationRecord, McpInvocationRecorder } from "../inspection-runner";

// ---------------------------------------------------------------------------
// Render_MCP response types (subset we depend on — Phase 1 read-only)
// ---------------------------------------------------------------------------

/**
 * One log line as returned by Render_MCP `list_logs`. The `message` is the
 * raw log payload (typically Pino JSON for SubNation services); `labels`
 * carry resource / instance / level / type metadata.
 */
export interface RenderLogEntry {
  readonly id: string;
  readonly message: string;
  readonly timestamp: string; // ISO-8601 UTC
  readonly labels: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

export interface RenderListLogsResult {
  readonly hasMore: boolean;
  readonly logs: ReadonlyArray<RenderLogEntry>;
  readonly nextStartTime?: string;
  readonly nextEndTime?: string;
}

/**
 * Subset of fields the audit cares about for `list_key_value`. Render's full
 * payload contains additional plan / region / status fields; we forward them
 * through `raw` for downstream consumers without re-typing them here.
 */
export interface RenderKeyValueInstance {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly plan?: string;
  readonly region?: string;
  readonly maxmemoryPolicy?: string;
}

/** Raw `list_key_value` response shape — Render returns either an array
 *  directly (the current MCP contract) or `{ instances: [...] }` (older
 *  REST shape). Both are accepted. */
export type RenderListKeyValueResult =
  | ReadonlyArray<RenderKeyValueInstance>
  | { readonly instances: ReadonlyArray<RenderKeyValueInstance> };

export interface RenderMetricSample {
  readonly timestamp: string;
  readonly value: number;
}

export interface RenderMetricSeries {
  readonly type: string;
  readonly data: ReadonlyArray<{
    readonly labels: ReadonlyArray<{ readonly field: string; readonly value: string }>;
    readonly unit?: string;
    readonly values: ReadonlyArray<RenderMetricSample>;
  }>;
}

export interface RenderGetMetricsResult {
  readonly resourceId: string;
  readonly timeRange: { readonly start: string; readonly end: string };
  readonly metrics: ReadonlyArray<RenderMetricSeries>;
}

// ---------------------------------------------------------------------------
// Audit client (transport seam)
// ---------------------------------------------------------------------------

/**
 * The three Render_MCP read-only tools the task-2.2 audit consumes. The
 * audit module never speaks MCP directly — callers wrap their preferred
 * MCP host (Kiro IDE, an external runner, or a deterministic test fake)
 * in this interface.
 */
export interface RenderAuditClient {
  listLogs(input: {
    readonly resource: ReadonlyArray<string>;
    readonly startTime?: string;
    readonly endTime?: string;
    readonly limit?: number;
    readonly direction?: "backward" | "forward";
  }): Promise<RenderListLogsResult>;

  listKeyValue(): Promise<RenderListKeyValueResult>;

  getMetrics(input: {
    readonly resourceId: string;
    readonly metricTypes: ReadonlyArray<string>;
    readonly startTime: string;
    readonly endTime: string;
    readonly resolution?: number;
  }): Promise<RenderGetMetricsResult>;
}

// ---------------------------------------------------------------------------
// Findings model (persisted to `inspection-data/render-audit-task-2.2.json`)
// ---------------------------------------------------------------------------

export interface RenderLogsSummary {
  readonly sampledCount: number;
  readonly hasMore: boolean;
  /** Distinct request URLs / paths surfaced by the sample, capped at 50. */
  readonly uniquePaths: ReadonlyArray<string>;
  /** Histogram of HTTP status codes parsed out of Pino `res.statusCode`. */
  readonly statusCodes: Readonly<Record<string, number>>;
  /** Mean / max responseTime in milliseconds across parseable lines. */
  readonly avgResponseTimeMs: number | null;
  readonly maxResponseTimeMs: number | null;
  /** Distinct label `type` values, e.g. `app`, `request`, `build`. */
  readonly labelTypes: ReadonlyArray<string>;
}

export interface RenderMetricsSummary {
  readonly cpu: RenderMetricStats;
  readonly memory: RenderMetricStats;
  readonly requestCount: RenderMetricStats;
}

export interface RenderMetricStats {
  readonly instances: number;
  readonly samples: number;
  readonly mean: number | null;
  readonly max: number | null;
  readonly min: number | null;
}

export interface RenderPhase22Findings {
  /** Schema version for downstream consumers — bump on breaking change. */
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly task: "2.2";
  readonly webServiceId: string;
  readonly windows: {
    readonly logs: {
      readonly startTime: string;
      readonly endTime: string;
      readonly durationHours: number;
    };
    readonly metrics: {
      readonly startTime: string;
      readonly endTime: string;
      readonly durationHours: number;
      readonly resolutionSec: number;
    };
  };
  readonly logs: {
    readonly summary: RenderLogsSummary;
    readonly raw: RenderListLogsResult;
  };
  readonly keyValueInstances: {
    readonly count: number;
    readonly instances: ReadonlyArray<RenderKeyValueInstance>;
    readonly raw: RenderListKeyValueResult;
  };
  readonly metrics: {
    readonly metricTypesRequested: ReadonlyArray<string>;
    readonly seriesCount: number;
    readonly summary: RenderMetricsSummary;
    readonly raw: RenderGetMetricsResult;
  };
  /** Subset of `report.mcpInvocations` produced by this audit step. */
  readonly invocations: ReadonlyArray<McpInvocationRecord>;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RunRenderPhase22AuditOptions {
  /** Recorder owning `report.mcpInvocations`. Required (Property 22). */
  readonly recorder: McpInvocationRecorder;
  /** Transport — wraps Render_MCP for the three tool calls. Required. */
  readonly client: RenderAuditClient;
  /** Web service ID — defaults to the production `subnation2` service. */
  readonly webServiceId?: string;
  /** Defaults to `() => new Date()`. Test seam for deterministic windows. */
  readonly now?: () => Date;
  /** Logs window length, milliseconds. R1.2 mandates 1 h. Default: 1 h. */
  readonly logsLookbackMs?: number;
  /** Metrics window length, milliseconds. R1.2 mandates 24 h. Default: 24 h. */
  readonly metricsLookbackMs?: number;
  /** `get_metrics.resolution` in seconds. Default 600 s (10-min buckets). */
  readonly metricsResolutionSec?: number;
  /** Page size hint for `list_logs`. Default 100 (Render's max). */
  readonly logsLimit?: number;
}

/** Production constant — `subnation2` web service on Render Oregon. */
export const PROD_WEB_SERVICE_ID = "srv-d7vv91tckfvc73evnccg";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Drive the three Render_MCP read-only calls required by task 2.2. Each
 * call is routed through the supplied `McpInvocationRecorder` so the
 * runner's `report.mcpInvocations` array gains exactly one record per
 * call (Property 22).
 *
 * Returns a structured findings document ready to persist to
 * `.kiro/specs/observability-seo-cwv-maturity/inspection-data/render-audit-task-2.2.json`.
 *
 * Error behavior: any tool call that exhausts its retry budget surfaces
 * the original `McpInvocationError` (Property 24). Callers SHOULD treat
 * this as a hard halt for the dependent step and let Memory_MCP record
 * the blocker via the recorder's blocker sink.
 */
export async function runRenderPhase22Audit(
  opts: RunRenderPhase22AuditOptions,
): Promise<RenderPhase22Findings> {
  if (!opts.recorder) {
    throw new TypeError("runRenderPhase22Audit: `recorder` is required (Property 22).");
  }
  if (!opts.client) {
    throw new TypeError("runRenderPhase22Audit: `client` is required.");
  }

  const webServiceId = opts.webServiceId ?? PROD_WEB_SERVICE_ID;
  const now = (opts.now ?? (() => new Date()))();
  const logsLookbackMs = opts.logsLookbackMs ?? HOUR_MS;
  const metricsLookbackMs = opts.metricsLookbackMs ?? DAY_MS;
  const resolutionSec = opts.metricsResolutionSec ?? 600;
  const logsLimit = opts.logsLimit ?? 100;

  const logsEnd = now.toISOString();
  const logsStart = new Date(now.getTime() - logsLookbackMs).toISOString();
  const metricsEnd = logsEnd;
  const metricsStart = new Date(now.getTime() - metricsLookbackMs).toISOString();

  // Snapshot the recorder's invocations array up-front so we can slice the
  // records this audit appended without coupling to internal iteration order.
  const invocationsBefore = opts.recorder.invocations.length;

  // ── 1. list_logs (web service, last 1 h) ────────────────────────────────
  const logsResult = await opts.recorder.invoke<RenderListLogsResult>(
    {
      server: "render",
      tool: "list_logs",
      paramsRedacted: {
        resource: [webServiceId],
        startTime: logsStart,
        endTime: logsEnd,
        limit: logsLimit,
        direction: "backward",
      },
      outputRef: "inspection-data/render-audit-task-2.2.json#logs",
    },
    () =>
      opts.client.listLogs({
        resource: [webServiceId],
        startTime: logsStart,
        endTime: logsEnd,
        limit: logsLimit,
        direction: "backward",
      }),
  );

  // ── 2. list_key_value (Redis instance) ──────────────────────────────────
  const keyValueResult = await opts.recorder.invoke<RenderListKeyValueResult>(
    {
      server: "render",
      tool: "list_key_value",
      paramsRedacted: {},
      outputRef: "inspection-data/render-audit-task-2.2.json#keyValueInstances",
    },
    () => opts.client.listKeyValue(),
  );

  // ── 3. get_metrics (CPU / memory / request count, last 24 h) ────────────
  const metricTypes: ReadonlyArray<string> = ["cpu_usage", "memory_usage", "http_request_count"];
  const metricsResult = await opts.recorder.invoke<RenderGetMetricsResult>(
    {
      server: "render",
      tool: "get_metrics",
      paramsRedacted: {
        resourceId: webServiceId,
        metricTypes,
        startTime: metricsStart,
        endTime: metricsEnd,
        resolution: resolutionSec,
      },
      outputRef: "inspection-data/render-audit-task-2.2.json#metrics",
    },
    () =>
      opts.client.getMetrics({
        resourceId: webServiceId,
        metricTypes,
        startTime: metricsStart,
        endTime: metricsEnd,
        resolution: resolutionSec,
      }),
  );

  const invocationsAfter = opts.recorder.invocations.slice(invocationsBefore);

  return Object.freeze({
    schemaVersion: 1 as const,
    capturedAt: now.toISOString(),
    task: "2.2" as const,
    webServiceId,
    windows: {
      logs: {
        startTime: logsStart,
        endTime: logsEnd,
        durationHours: logsLookbackMs / HOUR_MS,
      },
      metrics: {
        startTime: metricsStart,
        endTime: metricsEnd,
        durationHours: metricsLookbackMs / HOUR_MS,
        resolutionSec,
      },
    },
    logs: {
      summary: summarizeLogs(logsResult),
      raw: logsResult,
    },
    keyValueInstances: {
      count: extractKeyValueInstances(keyValueResult).length,
      instances: extractKeyValueInstances(keyValueResult),
      raw: keyValueResult,
    },
    metrics: {
      metricTypesRequested: metricTypes,
      seriesCount: metricsResult.metrics.length,
      summary: summarizeMetrics(metricsResult),
      raw: metricsResult,
    },
    invocations: invocationsAfter,
  });
}

// ---------------------------------------------------------------------------
// Internal summarizers
// ---------------------------------------------------------------------------

function summarizeLogs(result: RenderListLogsResult): RenderLogsSummary {
  const paths = new Set<string>();
  const labelTypes = new Set<string>();
  const statusCodes: Record<string, number> = {};

  let totalRespTime = 0;
  let respTimeSamples = 0;
  let maxRespTime = -Infinity;

  for (const entry of result.logs) {
    for (const label of entry.labels) {
      if (label.name === "type") labelTypes.add(label.value);
    }

    const parsed = tryParseJson(entry.message);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const req = obj.req as { url?: string } | undefined;
      const res = obj.res as { statusCode?: number } | undefined;
      const responseTime = typeof obj.responseTime === "number" ? obj.responseTime : null;

      if (req?.url && typeof req.url === "string") paths.add(redactUrl(req.url));
      if (res?.statusCode !== undefined) {
        const code = String(res.statusCode);
        statusCodes[code] = (statusCodes[code] ?? 0) + 1;
      }
      if (responseTime !== null && Number.isFinite(responseTime)) {
        totalRespTime += responseTime;
        respTimeSamples += 1;
        if (responseTime > maxRespTime) maxRespTime = responseTime;
      }
    }
  }

  return {
    sampledCount: result.logs.length,
    hasMore: result.hasMore,
    uniquePaths: Array.from(paths).sort().slice(0, 50),
    statusCodes,
    avgResponseTimeMs: respTimeSamples > 0 ? totalRespTime / respTimeSamples : null,
    maxResponseTimeMs: maxRespTime === -Infinity ? null : maxRespTime,
    labelTypes: Array.from(labelTypes).sort(),
  };
}

function extractKeyValueInstances(
  raw: RenderListKeyValueResult,
): ReadonlyArray<RenderKeyValueInstance> {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { instances?: unknown }).instances)) {
    return (raw as { instances: ReadonlyArray<RenderKeyValueInstance> }).instances;
  }
  return [];
}

function summarizeMetrics(result: RenderGetMetricsResult): RenderMetricsSummary {
  const byType: Record<string, RenderMetricSeries[]> = {};
  for (const series of result.metrics) {
    (byType[series.type] ??= []).push(series);
  }

  return {
    cpu: statsForType(byType["cpu_usage"]),
    memory: statsForType(byType["memory_usage"]),
    requestCount: statsForType(byType["http_request_count"]),
  };
}

function statsForType(series: ReadonlyArray<RenderMetricSeries> | undefined): RenderMetricStats {
  if (!series || series.length === 0) {
    return { instances: 0, samples: 0, mean: null, max: null, min: null };
  }

  let total = 0;
  let count = 0;
  let max = -Infinity;
  let min = Infinity;
  let instances = 0;

  for (const s of series) {
    for (const inst of s.data) {
      instances += 1;
      for (const sample of inst.values) {
        if (!Number.isFinite(sample.value)) continue;
        total += sample.value;
        count += 1;
        if (sample.value > max) max = sample.value;
        if (sample.value < min) min = sample.value;
      }
    }
  }

  return {
    instances,
    samples: count,
    mean: count > 0 ? total / count : null,
    max: max === -Infinity ? null : max,
    min: min === Infinity ? null : min,
  };
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Redact a URL path's query string and fragment so we never persist
 * potentially sensitive query parameters (e.g. session tokens passed via
 * link tracking) into `inspection-data/`. The path itself is kept because
 * it is the unit of analysis for downstream Phase 1 reports.
 */
function redactUrl(url: string): string {
  const qIdx = url.indexOf("?");
  const hIdx = url.indexOf("#");
  let cut = url.length;
  if (qIdx >= 0) cut = Math.min(cut, qIdx);
  if (hIdx >= 0) cut = Math.min(cut, hIdx);
  return url.slice(0, cut);
}
