import { describe, expect, it } from "vitest";

import {
  DEFAULT_MCP_RETRY_POLICY,
  McpInvocationError,
  McpInvocationRecorder,
  createMcpInvocationRecorder,
  runInspection,
  type McpInvocationFailure,
  type McpInvocationRecord,
} from "../inspection-runner";

/**
 * Unit tests for the MCP invocation recorder + retry policy added by
 * task 1.3 of the observability-seo-cwv-maturity spec.
 *
 * These tests validate the deterministic record-keeping and retry budget
 * contracts (R10.1–R10.5, R10.8). The PBT counterparts (Properties 22 & 24)
 * land in tasks 1.4 and 1.5 respectively.
 */

describe("inspection-runner / McpInvocationRecorder", () => {
  const stableNow = () => new Date("2025-01-01T00:00:00.000Z");
  const noSleep = async (_ms: number) => {
    /* deterministic — never actually sleep in tests */
  };

  it("appends exactly one record per successful invocation", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = new McpInvocationRecorder(invocations, {
      sleep: noSleep,
      now: stableNow,
    });

    const result = await recorder.invoke(
      {
        server: "render",
        tool: "list_services",
        paramsRedacted: { region: "oregon" },
        outputRef: "report#render-services",
      },
      async () => ({ services: ["subnation2"] }),
    );

    expect(result).toEqual({ services: ["subnation2"] });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      server: "render",
      tool: "list_services",
      paramsRedacted: { region: "oregon" },
      invokedAt: "2025-01-01T00:00:00.000Z",
      outputRef: "report#render-services",
      retries: 0,
    });
  });

  it("retries up to 3 times then succeeds, recording the retry count", async () => {
    const invocations: McpInvocationRecord[] = [];
    const slept: number[] = [];
    const recorder = new McpInvocationRecorder(invocations, {
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: stableNow,
    });

    let attempts = 0;
    const value = await recorder.invoke(
      {
        server: "neon",
        tool: "list_projects",
        paramsRedacted: { queryText: "SELECT 1" },
      },
      async () => {
        attempts += 1;
        if (attempts < 4) throw new Error(`transient ${attempts}`);
        return "ok";
      },
    );

    expect(value).toBe("ok");
    expect(attempts).toBe(4); // 1 initial + 3 retries
    expect(slept).toEqual([1_000, 5_000, 15_000]);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.retries).toBe(3);
  });

  it("halts and emits a blocker entry once retries are exhausted", async () => {
    const invocations: McpInvocationRecord[] = [];
    const blockers: McpInvocationFailure[] = [];

    const recorder = createMcpInvocationRecorder(invocations, {
      sleep: noSleep,
      now: stableNow,
      recordBlocker: (failure) => {
        blockers.push(failure);
      },
    });

    await expect(
      recorder.invoke(
        {
          server: "context7",
          tool: "query-docs",
          paramsRedacted: { libraryId: "/sentry/sentry", query: "release tracking" },
        },
        async () => {
          throw new Error("network down");
        },
      ),
    ).rejects.toBeInstanceOf(McpInvocationError);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.retries).toBe(3);
    expect(invocations[0]?.outputRef).toBe("failed:context7:query-docs");

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({
      server: "context7",
      tool: "query-docs",
      retries: 3,
      error: "network down",
      params: { libraryId: "/sentry/sentry", query: "release tracking" },
    });
    expect(typeof blockers[0]?.failedAt).toBe("string");
  });

  it("respects the cumulative-wait budget and stops early when a backoff would exceed it", async () => {
    const invocations: McpInvocationRecord[] = [];
    const slept: number[] = [];
    const blockers: McpInvocationFailure[] = [];

    // Tight budget: only the first 1 s backoff fits; 1 s + 5 s = 6 s > 5 s.
    const recorder = new McpInvocationRecorder(invocations, {
      policy: { backoffsMs: [1_000, 5_000, 15_000], cumulativeBudgetMs: 5_000 },
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: stableNow,
      recordBlocker: (f) => {
        blockers.push(f);
      },
    });

    await expect(
      recorder.invoke(
        {
          server: "ruflo",
          tool: "get_traces",
          paramsRedacted: {},
        },
        async () => {
          throw new Error("flaky");
        },
      ),
    ).rejects.toBeInstanceOf(McpInvocationError);

    // Only the first retry's sleep fits in the budget.
    expect(slept).toEqual([1_000]);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.retries).toBe(1);
    expect(blockers[0]?.retries).toBe(1);
  });

  it("default policy has cumulative wait <= 30s and at most 3 retries", () => {
    const total = DEFAULT_MCP_RETRY_POLICY.backoffsMs.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(DEFAULT_MCP_RETRY_POLICY.cumulativeBudgetMs);
    expect(DEFAULT_MCP_RETRY_POLICY.cumulativeBudgetMs).toBeLessThanOrEqual(30_000);
    expect(DEFAULT_MCP_RETRY_POLICY.backoffsMs.length).toBe(3);
    expect([...DEFAULT_MCP_RETRY_POLICY.backoffsMs]).toEqual([1_000, 5_000, 15_000]);
  });

  it("rejects empty tool names and invalid policies", () => {
    const invocations: McpInvocationRecord[] = [];

    expect(
      () =>
        new McpInvocationRecorder(invocations, {
          policy: { backoffsMs: [-1], cumulativeBudgetMs: 1_000 },
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new McpInvocationRecorder(invocations, {
          policy: { backoffsMs: [1_000], cumulativeBudgetMs: -5 },
        }),
    ).toThrow(RangeError);

    const recorder = new McpInvocationRecorder(invocations, {
      sleep: noSleep,
      now: stableNow,
    });

    return expect(
      recorder.invoke({ server: "memory", tool: "", paramsRedacted: {} }, async () => null),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("runInspection wires a recorder that appends into report.mcpInvocations", async () => {
    const blockers: McpInvocationFailure[] = [];
    const { report, recorder } = await runInspection({
      sleep: noSleep,
      now: stableNow,
      recordBlocker: (f) => {
        blockers.push(f);
      },
    });

    await recorder.invoke(
      {
        server: "memory",
        tool: "memory_search_nodes",
        paramsRedacted: { query: "observability-seo-cwv-maturity:*" },
      },
      async () => ({ nodes: [] }),
    );

    expect(report.mcpInvocations).toHaveLength(1);
    expect(report.mcpInvocations[0]?.tool).toBe("memory_search_nodes");
    expect(blockers).toHaveLength(0);
  });
});
