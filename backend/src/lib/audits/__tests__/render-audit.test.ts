import { describe, expect, it, vi } from "vitest";

import { createMcpInvocationRecorder, type McpInvocationRecord } from "../../inspection-runner";
import {
  PROD_WEB_SERVICE_ID,
  runRenderPhase22Audit,
  type RenderAuditClient,
  type RenderGetMetricsResult,
  type RenderListKeyValueResult,
  type RenderListLogsResult,
} from "../render-audit";

/**
 * Unit tests for `runRenderPhase22Audit` (task 2.2).
 *
 * Validates:
 *   • Property 22 — exactly one `McpInvocationRecord` is appended per
 *     MCP tool call (3 calls → 3 records).
 *   • Each record has the expected `server`, `tool`, `paramsRedacted`,
 *     and `outputRef` shape.
 *   • The findings document summarizes logs, key-value instances, and
 *     metrics correctly.
 *   • The 1 h logs window and 24 h metrics window are computed against
 *     the supplied clock.
 */

const FIXED_NOW = new Date("2026-05-15T19:35:00.000Z");

function buildLogsFixture(): RenderListLogsResult {
  return {
    hasMore: true,
    logs: [
      {
        id: "log-1",
        timestamp: "2026-05-15T19:30:00.000Z",
        labels: [
          { name: "type", value: "app" },
          { name: "level", value: "info" },
        ],
        message: JSON.stringify({
          level: 30,
          msg: "request completed",
          req: { url: "/api/notifications?token=abc" },
          res: { statusCode: 304 },
          responseTime: 460,
        }),
      },
      {
        id: "log-2",
        timestamp: "2026-05-15T19:31:00.000Z",
        labels: [{ name: "type", value: "app" }],
        message: JSON.stringify({
          req: { url: "/api/auth/me" },
          res: { statusCode: 401 },
          responseTime: 1,
        }),
      },
      {
        id: "log-3",
        timestamp: "2026-05-15T19:32:00.000Z",
        labels: [{ name: "type", value: "request" }],
        message: "non-json line — should not crash the summarizer",
      },
    ],
  };
}

function buildKeyValueFixture(): RenderListKeyValueResult {
  // Render returned an empty array in the live audit; vary the shape across
  // tests to verify the audit module accepts both contracts.
  return [];
}

function buildMetricsFixture(): RenderGetMetricsResult {
  return {
    resourceId: PROD_WEB_SERVICE_ID,
    timeRange: {
      start: "2026-05-14T19:35:00.000Z",
      end: "2026-05-15T19:35:00.000Z",
    },
    metrics: [
      {
        type: "cpu_usage",
        data: [
          {
            labels: [
              { field: "instance", value: "i-1" },
              { field: "service", value: PROD_WEB_SERVICE_ID },
            ],
            unit: "cpu",
            values: [
              { timestamp: "2026-05-15T00:00:00Z", value: 0.001 },
              { timestamp: "2026-05-15T00:10:00Z", value: 0.003 },
            ],
          },
        ],
      },
      {
        type: "memory_usage",
        data: [
          {
            labels: [{ field: "instance", value: "i-1" }],
            unit: "bytes",
            values: [
              { timestamp: "2026-05-15T00:00:00Z", value: 300_000_000 },
              { timestamp: "2026-05-15T00:10:00Z", value: 320_000_000 },
            ],
          },
        ],
      },
      {
        type: "http_request_count",
        data: [],
      },
    ],
  };
}

function makeClient(): RenderAuditClient {
  return {
    listLogs: vi.fn(async () => buildLogsFixture()),
    listKeyValue: vi.fn(async () => buildKeyValueFixture()),
    getMetrics: vi.fn(async () => buildMetricsFixture()),
  };
}

describe("render-audit / runRenderPhase22Audit", () => {
  it("appends exactly one McpInvocationRecord per call (Property 22)", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = createMcpInvocationRecorder(invocations, {
      now: () => FIXED_NOW,
      sleep: async () => {},
    });

    const findings = await runRenderPhase22Audit({
      recorder,
      client: makeClient(),
      now: () => FIXED_NOW,
    });

    expect(invocations).toHaveLength(3);
    expect(invocations.map((r) => r.tool)).toEqual(["list_logs", "list_key_value", "get_metrics"]);
    for (const record of invocations) {
      expect(record.server).toBe("render");
      expect(record.retries).toBe(0);
      expect(typeof record.invokedAt).toBe("string");
      expect(record.outputRef).toMatch(/inspection-data\/render-audit-task-2\.2\.json/);
    }
    expect(findings.invocations).toHaveLength(3);
  });

  it("records the 1 h logs window and 24 h metrics window from the supplied clock", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = createMcpInvocationRecorder(invocations, {
      now: () => FIXED_NOW,
      sleep: async () => {},
    });
    const client = makeClient();

    const findings = await runRenderPhase22Audit({
      recorder,
      client,
      now: () => FIXED_NOW,
    });

    expect(findings.windows.logs).toEqual({
      startTime: "2026-05-15T18:35:00.000Z",
      endTime: "2026-05-15T19:35:00.000Z",
      durationHours: 1,
    });
    expect(findings.windows.metrics).toEqual({
      startTime: "2026-05-14T19:35:00.000Z",
      endTime: "2026-05-15T19:35:00.000Z",
      durationHours: 24,
      resolutionSec: 600,
    });

    const listLogsCall = (client.listLogs as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(listLogsCall).toMatchObject({
      resource: [PROD_WEB_SERVICE_ID],
      startTime: "2026-05-15T18:35:00.000Z",
      endTime: "2026-05-15T19:35:00.000Z",
      direction: "backward",
    });

    const getMetricsCall = (client.getMetrics as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(getMetricsCall).toMatchObject({
      resourceId: PROD_WEB_SERVICE_ID,
      metricTypes: ["cpu_usage", "memory_usage", "http_request_count"],
      startTime: "2026-05-14T19:35:00.000Z",
      endTime: "2026-05-15T19:35:00.000Z",
      resolution: 600,
    });
  });

  it("summarizes logs by status code, redacts query strings, and tolerates non-JSON lines", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = createMcpInvocationRecorder(invocations, {
      now: () => FIXED_NOW,
      sleep: async () => {},
    });

    const findings = await runRenderPhase22Audit({
      recorder,
      client: makeClient(),
      now: () => FIXED_NOW,
    });

    expect(findings.logs.summary.sampledCount).toBe(3);
    expect(findings.logs.summary.hasMore).toBe(true);
    expect(findings.logs.summary.statusCodes).toEqual({ "304": 1, "401": 1 });
    // Query string `?token=abc` MUST NOT survive into uniquePaths.
    expect(findings.logs.summary.uniquePaths).toContain("/api/notifications");
    expect(findings.logs.summary.uniquePaths).toContain("/api/auth/me");
    expect(findings.logs.summary.uniquePaths.join("|")).not.toContain("token");
    expect(findings.logs.summary.labelTypes).toEqual(["app", "request"]);
    // mean = (460 + 1) / 2 = 230.5
    expect(findings.logs.summary.avgResponseTimeMs).toBeCloseTo(230.5, 5);
    expect(findings.logs.summary.maxResponseTimeMs).toBe(460);
  });

  it("counts key-value instances from both the array and `{instances: []}` shapes", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = createMcpInvocationRecorder(invocations, {
      now: () => FIXED_NOW,
      sleep: async () => {},
    });

    const findings = await runRenderPhase22Audit({
      recorder,
      client: {
        listLogs: async () => buildLogsFixture(),
        listKeyValue: async () => ({
          instances: [
            {
              id: "redis-1",
              name: "subnation-redis",
              status: "available",
              plan: "free",
              region: "oregon",
              maxmemoryPolicy: "allkeys-lru",
            },
          ],
        }),
        getMetrics: async () => buildMetricsFixture(),
      },
      now: () => FIXED_NOW,
    });

    expect(findings.keyValueInstances.count).toBe(1);
    expect(findings.keyValueInstances.instances[0]?.name).toBe("subnation-redis");
  });

  it("computes per-metric mean/max/min stats and tolerates empty series", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = createMcpInvocationRecorder(invocations, {
      now: () => FIXED_NOW,
      sleep: async () => {},
    });

    const findings = await runRenderPhase22Audit({
      recorder,
      client: makeClient(),
      now: () => FIXED_NOW,
    });

    expect(findings.metrics.metricTypesRequested).toEqual([
      "cpu_usage",
      "memory_usage",
      "http_request_count",
    ]);
    expect(findings.metrics.seriesCount).toBe(3);
    expect(findings.metrics.summary.cpu).toMatchObject({ samples: 2, max: 0.003, min: 0.001 });
    expect(findings.metrics.summary.memory.samples).toBe(2);
    expect(findings.metrics.summary.requestCount).toEqual({
      instances: 0,
      samples: 0,
      mean: null,
      max: null,
      min: null,
    });
  });

  it("rejects when no recorder or client is provided", async () => {
    // Type cast intentional — we are exercising the runtime guards.
    await expect(
      runRenderPhase22Audit({
        recorder: undefined as unknown as ReturnType<typeof createMcpInvocationRecorder>,
        client: makeClient(),
      }),
    ).rejects.toBeInstanceOf(TypeError);

    const recorder = createMcpInvocationRecorder([], { sleep: async () => {} });
    await expect(
      runRenderPhase22Audit({
        recorder,
        client: undefined as unknown as RenderAuditClient,
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
