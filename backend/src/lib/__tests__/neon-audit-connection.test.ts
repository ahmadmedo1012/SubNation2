import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_INFLIGHT_QUERY_TEXT_BYTES,
  NEON_AUDIT_OUTPUT_DIR,
  NEON_CONNECTION_SUMMARY_SQL,
  NEON_INFLIGHT_QUERIES_SQL,
  createDefaultNeonAuditPersister,
  parseConnectionStateRows,
  parseInFlightQueryRows,
  runNeonConnectionAudit,
  runNeonConnectionSummary,
  runNeonInFlightQueries,
  type NeonAuditPersister,
  type NeonAuditRow,
} from "../audits/neon-audit";
import {
  McpInvocationError,
  McpInvocationRecorder,
  type McpInvocationRecord,
} from "../inspection-runner";

/**
 * Unit tests for task 3.2 — Neon_MCP connection summary + in-flight queries.
 *
 * Pinned contract:
 *   1. The runner records exactly one McpInvocationRecord per Neon call
 *      (Property 22 — Neon clause).
 *   2. `paramsRedacted.queryText` carries the exact SQL string
 *      (R10.2).
 *   3. Captured rows are persisted to
 *      `.kiro/specs/observability-seo-cwv-maturity/inspection-data/`
 *      (R1.3).
 *   4. Failures from the underlying Neon tool surface as
 *      `McpInvocationError` after the recorder's retry budget is
 *      exhausted (Property 24).
 *   5. Composition halts before the in-flight step when the
 *      connection-summary step fails (Property 24, dependent steps).
 */

const stableNow = () => new Date("2025-01-01T00:00:00.000Z");
const noSleep = async (_ms: number) => {
  /* deterministic */
};

function makeRecorder(invocations: McpInvocationRecord[]): McpInvocationRecorder {
  return new McpInvocationRecorder(invocations, { sleep: noSleep, now: stableNow });
}

function memoryPersister(): {
  persister: NeonAuditPersister;
  writes: Array<{ filename: string; payload: unknown }>;
} {
  const writes: Array<{ filename: string; payload: unknown }> = [];
  const persister: NeonAuditPersister = async (filename, payload) => {
    writes.push({ filename, payload });
    return path.posix.join(NEON_AUDIT_OUTPUT_DIR, filename);
  };
  return { persister, writes };
}

describe("neon-audit (task 3.2) / SQL constants", () => {
  it("connection-summary SQL groups pg_stat_activity by state", () => {
    expect(NEON_CONNECTION_SUMMARY_SQL).toContain("FROM pg_stat_activity");
    expect(NEON_CONNECTION_SUMMARY_SQL).toContain("GROUP BY state");
  });

  it("in-flight SQL excludes idle backends and the audit's own pid", () => {
    expect(NEON_INFLIGHT_QUERIES_SQL).toContain("FROM pg_stat_activity");
    expect(NEON_INFLIGHT_QUERIES_SQL).toContain("state IS DISTINCT FROM 'idle'");
    expect(NEON_INFLIGHT_QUERIES_SQL).toContain("pid <> pg_backend_pid()");
  });
});

describe("neon-audit (task 3.2) / runNeonConnectionSummary", () => {
  it("records exactly one invocation with the exact SQL in paramsRedacted.queryText", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister, writes } = memoryPersister();

    const sampleRows: NeonAuditRow[] = [
      { state: "active", connection_count: 3 },
      { state: "idle", connection_count: 7 },
      { state: null, connection_count: 1 },
    ];

    const finding = await runNeonConnectionSummary({
      recorder,
      runQuery: async () => sampleRows,
      persister,
      now: stableNow,
    });

    expect(invocations).toHaveLength(1);
    const record = invocations[0]!;
    expect(record.server).toBe("neon");
    expect(record.tool).toBe("query_render_postgres");
    // R10.2 + Property 22 (Neon clause) — exact SQL stored verbatim
    expect(record.paramsRedacted).toMatchObject({ queryText: NEON_CONNECTION_SUMMARY_SQL });
    expect(record.outputRef).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-connection-summary.json`);
    expect(record.retries).toBe(0);

    expect(finding.queryText).toBe(NEON_CONNECTION_SUMMARY_SQL);
    expect(finding.totalConnections).toBe(11);
    expect(finding.byState).toEqual([
      { state: "active", connectionCount: 3 },
      { state: "idle", connectionCount: 7 },
      { state: null, connectionCount: 1 },
    ]);
    expect(finding.outputRef).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-connection-summary.json`);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.filename).toBe("neon-connection-summary.json");
    expect((writes[0]!.payload as { queryText: string }).queryText).toBe(
      NEON_CONNECTION_SUMMARY_SQL,
    );
  });

  it("propagates McpInvocationError after retry exhaustion and writes nothing", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister, writes } = memoryPersister();

    let attempts = 0;
    await expect(
      runNeonConnectionSummary({
        recorder,
        runQuery: async () => {
          attempts += 1;
          throw new Error("permission denied for view pg_stat_activity");
        },
        persister,
        now: stableNow,
      }),
    ).rejects.toBeInstanceOf(McpInvocationError);

    expect(attempts).toBe(4); // 1 initial + 3 retries
    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.retries).toBe(3);
    expect(writes).toHaveLength(0);
  });
});

describe("neon-audit (task 3.2) / runNeonInFlightQueries", () => {
  it("records exactly one invocation and persists the canonical payload", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister, writes } = memoryPersister();

    const sampleRows: NeonAuditRow[] = [
      {
        pid: 12345,
        state: "active",
        query: "SELECT pg_sleep(60);",
        query_start: "2025-01-01T00:00:00.000Z",
        state_change: "2025-01-01T00:00:00.500Z",
        datname: "subnation",
        usename: "subnation_app",
        application_name: "express-api",
        duration_ms: "296500",
      },
    ];

    const finding = await runNeonInFlightQueries({
      recorder,
      runQuery: async () => sampleRows,
      persister,
      now: stableNow,
    });

    expect(invocations).toHaveLength(1);
    const record = invocations[0]!;
    expect(record.server).toBe("neon");
    expect(record.paramsRedacted).toMatchObject({ queryText: NEON_INFLIGHT_QUERIES_SQL });
    expect(record.outputRef).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-inflight-queries.json`);

    expect(finding.queryText).toBe(NEON_INFLIGHT_QUERIES_SQL);
    expect(finding.rows).toEqual([
      {
        pid: 12345,
        state: "active",
        query: "SELECT pg_sleep(60);",
        queryStart: "2025-01-01T00:00:00.000Z",
        stateChange: "2025-01-01T00:00:00.500Z",
        database: "subnation",
        user: "subnation_app",
        applicationName: "express-api",
        durationMs: 296500,
      },
    ]);
    expect(writes[0]!.filename).toBe("neon-inflight-queries.json");
  });
});

describe("neon-audit (task 3.2) / runNeonConnectionAudit composition", () => {
  it("invokes both audit steps in order and returns combined findings", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister } = memoryPersister();

    const calls: string[] = [];
    const findings = await runNeonConnectionAudit({
      recorder,
      runQuery: async (sql) => {
        calls.push(sql);
        return [];
      },
      persister,
      now: stableNow,
    });

    expect(calls).toEqual([NEON_CONNECTION_SUMMARY_SQL, NEON_INFLIGHT_QUERIES_SQL]);
    expect(invocations).toHaveLength(2);
    expect(invocations.map((r) => r.server)).toEqual(["neon", "neon"]);
    expect(findings.connectionSummary.queryText).toBe(NEON_CONNECTION_SUMMARY_SQL);
    expect(findings.inFlightQueries.queryText).toBe(NEON_INFLIGHT_QUERIES_SQL);
  });

  it("halts before the in-flight step when the connection-summary step is exhausted", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister } = memoryPersister();

    const calls: string[] = [];
    await expect(
      runNeonConnectionAudit({
        recorder,
        runQuery: async (sql) => {
          calls.push(sql);
          if (sql === NEON_CONNECTION_SUMMARY_SQL) throw new Error("connection terminated");
          return [];
        },
        persister,
        now: stableNow,
      }),
    ).rejects.toBeInstanceOf(McpInvocationError);

    expect(calls.filter((s) => s === NEON_CONNECTION_SUMMARY_SQL)).toHaveLength(4);
    expect(calls).not.toContain(NEON_INFLIGHT_QUERIES_SQL);
    expect(invocations).toHaveLength(1);
  });
});

describe("neon-audit (task 3.2) / parsers", () => {
  it("tolerates string-encoded bigints from postgres count(*)", () => {
    const rows = parseConnectionStateRows([
      { state: "idle", connection_count: "42" },
      { state: "active", count: "7" }, // fallback alias when no AS rename
    ]);
    expect(rows).toEqual([
      { state: "idle", connectionCount: 42 },
      { state: "active", connectionCount: 7 },
    ]);
  });

  it("parses connection-summary rows nested under { rows: [...] }", () => {
    const rows = parseConnectionStateRows({
      rows: [{ state: "idle in transaction", connection_count: 2 }],
    });
    expect(rows).toEqual([{ state: "idle in transaction", connectionCount: 2 }]);
  });

  it("returns [] for malformed input", () => {
    expect(parseConnectionStateRows(null)).toEqual([]);
    expect(parseConnectionStateRows("not-an-array")).toEqual([]);
    expect(parseInFlightQueryRows({ rows: "nope" })).toEqual([]);
  });

  it("truncates pathologically long query text on in-flight rows", () => {
    const longQuery = "SELECT '" + "x".repeat(MAX_INFLIGHT_QUERY_TEXT_BYTES * 2) + "';";
    const rows = parseInFlightQueryRows([
      {
        pid: 1,
        state: "active",
        query: longQuery,
        query_start: null,
        state_change: null,
        datname: "db",
        usename: "u",
        application_name: "a",
        duration_ms: 1,
      },
    ]);
    expect(rows[0]?.query).not.toBeNull();
    expect((rows[0]?.query ?? "").length).toBeLessThanOrEqual(MAX_INFLIGHT_QUERY_TEXT_BYTES);
    expect((rows[0]?.query ?? "").endsWith("…")).toBe(true);
  });

  it("normalises Date instances to ISO-8601 strings", () => {
    const rows = parseInFlightQueryRows([
      {
        pid: 1,
        state: "active",
        query: "SELECT 1",
        query_start: new Date("2025-01-01T00:00:00.000Z"),
        state_change: new Date("2025-01-01T00:00:00.500Z"),
        datname: "db",
        usename: "u",
        application_name: "a",
        duration_ms: 500,
      },
    ]);
    expect(rows[0]?.queryStart).toBe("2025-01-01T00:00:00.000Z");
    expect(rows[0]?.stateChange).toBe("2025-01-01T00:00:00.500Z");
  });
});

describe("neon-audit (task 3.2) / persistence under inspection-data/", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "neon-audit-3-2-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes neon-connection-summary.json under the inspection-data directory", async () => {
    const persister = createDefaultNeonAuditPersister(tmp);
    const recorder = makeRecorder([]);

    await runNeonConnectionSummary({
      recorder,
      runQuery: async () => [{ state: "idle", connection_count: 5 }],
      persister,
      now: stableNow,
    });

    const absolute = path.join(tmp, NEON_AUDIT_OUTPUT_DIR, "neon-connection-summary.json");
    const parsed = JSON.parse(await readFile(absolute, "utf8")) as {
      queryText: string;
      totalConnections: number;
    };
    expect(parsed.queryText).toBe(NEON_CONNECTION_SUMMARY_SQL);
    expect(parsed.totalConnections).toBe(5);
  });
});
