import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NEON_AUDIT_OUTPUT_DIR,
  NEON_INDEX_SUMMARY_SQL,
  NEON_SLOW_QUERY_SQL,
  assertNeonRecordCarriesQueryText,
  createDefaultNeonAuditPersister,
  runNeonAudit,
  runNeonIndexSummary,
  runNeonSlowQuerySampling,
  type NeonAuditPersister,
  type NeonAuditRow,
} from "../audits/neon-audit";
import {
  McpInvocationError,
  McpInvocationRecorder,
  type McpInvocationRecord,
} from "../inspection-runner";

/**
 * Unit tests for task 3.1 — Neon_MCP slow-query sampling and index summary.
 *
 * These tests pin the contract that:
 *   1. The runner records exactly one McpInvocationRecord per Neon call.
 *   2. `paramsRedacted.queryText` carries the exact SQL string (Property 22).
 *   3. Captured rows are persisted to the inspection-data directory.
 *   4. Failures from the underlying Neon tool surface as McpInvocationError
 *      after the recorder's retry budget is exhausted (Property 24).
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

describe("neon-audit / SQL constants", () => {
  it("matches the example SQL from tasks.md §3.1 verbatim", () => {
    expect(NEON_SLOW_QUERY_SQL).toBe(
      "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20",
    );
    expect(NEON_INDEX_SUMMARY_SQL).toBe("SELECT * FROM pg_stat_user_indexes");
  });
});

describe("neon-audit / runNeonSlowQuerySampling", () => {
  it("records exactly one invocation with the exact SQL in paramsRedacted.queryText", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister, writes } = memoryPersister();

    const sampleRows: NeonAuditRow[] = [{ query: "SELECT 1", calls: 42, total_exec_time: 1234.5 }];

    const finding = await runNeonSlowQuerySampling({
      recorder,
      runQuery: async () => sampleRows,
      persister,
      now: stableNow,
    });

    expect(invocations).toHaveLength(1);
    const record = invocations[0]!;
    expect(record.server).toBe("neon");
    expect(record.tool).toBe("query_render_postgres");
    // Property 22 (Neon clause): exact SQL stored verbatim
    expect(record.paramsRedacted).toMatchObject({ queryText: NEON_SLOW_QUERY_SQL });
    expect(record.outputRef).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-slow-queries.json`);
    expect(record.retries).toBe(0);

    expect(finding.queryText).toBe(NEON_SLOW_QUERY_SQL);
    expect(finding.rows).toEqual(sampleRows);
    expect(finding.outputRef).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-slow-queries.json`);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.filename).toBe("neon-slow-queries.json");
    expect((writes[0]!.payload as { queryText: string }).queryText).toBe(NEON_SLOW_QUERY_SQL);
  });

  it("respects an overridden tool name on the recorded invocation", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister } = memoryPersister();

    await runNeonSlowQuerySampling({
      recorder,
      runQuery: async () => [],
      persister,
      toolName: "neon_run_sql",
      now: stableNow,
    });

    expect(invocations[0]!.tool).toBe("neon_run_sql");
  });

  it("propagates McpInvocationError after retry exhaustion and writes nothing", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister, writes } = memoryPersister();

    let attempts = 0;
    await expect(
      runNeonSlowQuerySampling({
        recorder,
        runQuery: async () => {
          attempts += 1;
          throw new Error("pg_stat_statements not loaded");
        },
        persister,
        now: stableNow,
      }),
    ).rejects.toBeInstanceOf(McpInvocationError);

    expect(attempts).toBe(4); // 1 initial + 3 retries
    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.retries).toBe(3);
    expect(writes).toHaveLength(0); // no partial persistence
  });
});

describe("neon-audit / runNeonIndexSummary", () => {
  it("records exactly one invocation with the index-summary SQL", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister, writes } = memoryPersister();

    const rows: NeonAuditRow[] = [
      { schemaname: "public", relname: "users", indexrelname: "users_pkey", idx_scan: 100 },
    ];

    const finding = await runNeonIndexSummary({
      recorder,
      runQuery: async () => rows,
      persister,
      now: stableNow,
    });

    expect(invocations).toHaveLength(1);
    const record = invocations[0]!;
    expect(record.server).toBe("neon");
    expect(record.paramsRedacted).toMatchObject({ queryText: NEON_INDEX_SUMMARY_SQL });
    expect(record.outputRef).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-index-summary.json`);

    expect(finding.queryText).toBe(NEON_INDEX_SUMMARY_SQL);
    expect(finding.rows).toEqual(rows);
    expect(writes[0]!.filename).toBe("neon-index-summary.json");
  });
});

describe("neon-audit / runNeonAudit composition", () => {
  it("invokes both audit steps in order and returns combined findings", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister } = memoryPersister();

    const calls: string[] = [];
    const findings = await runNeonAudit({
      recorder,
      runQuery: async (sql) => {
        calls.push(sql);
        return [];
      },
      persister,
      now: stableNow,
    });

    expect(calls).toEqual([NEON_SLOW_QUERY_SQL, NEON_INDEX_SUMMARY_SQL]);
    expect(invocations).toHaveLength(2);
    expect(invocations.map((r) => r.server)).toEqual(["neon", "neon"]);
    expect(findings.slowQuerySample.queryText).toBe(NEON_SLOW_QUERY_SQL);
    expect(findings.indexSummary.queryText).toBe(NEON_INDEX_SUMMARY_SQL);
  });

  it("halts before the index-summary step when the slow-query step is exhausted", async () => {
    const invocations: McpInvocationRecord[] = [];
    const recorder = makeRecorder(invocations);
    const { persister } = memoryPersister();

    const calls: string[] = [];
    await expect(
      runNeonAudit({
        recorder,
        runQuery: async (sql) => {
          calls.push(sql);
          if (sql === NEON_SLOW_QUERY_SQL) throw new Error("permission denied");
          return [];
        },
        persister,
        now: stableNow,
      }),
    ).rejects.toBeInstanceOf(McpInvocationError);

    // 4 attempts at the slow-query step + 0 attempts at the index-summary step
    expect(calls.filter((s) => s === NEON_SLOW_QUERY_SQL)).toHaveLength(4);
    expect(calls).not.toContain(NEON_INDEX_SUMMARY_SQL);
    // Property 22 still satisfied — exactly one record per Neon invocation
    expect(invocations).toHaveLength(1);
  });
});

describe("neon-audit / createDefaultNeonAuditPersister", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "neon-audit-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes a JSON file under the inspection-data directory", async () => {
    const persister = createDefaultNeonAuditPersister(tmp);
    const ref = await persister("neon-slow-queries.json", {
      capturedAt: "2025-01-01T00:00:00.000Z",
      queryText: NEON_SLOW_QUERY_SQL,
      rows: [],
    });

    expect(ref).toBe(`${NEON_AUDIT_OUTPUT_DIR}/neon-slow-queries.json`);
    const absolute = path.join(tmp, NEON_AUDIT_OUTPUT_DIR, "neon-slow-queries.json");
    const parsed = JSON.parse(await readFile(absolute, "utf8")) as { queryText: string };
    expect(parsed.queryText).toBe(NEON_SLOW_QUERY_SQL);
  });

  it("rejects filenames containing path separators or absolute paths", async () => {
    const persister = createDefaultNeonAuditPersister(tmp);
    await expect(persister("../escape.json", {})).rejects.toBeInstanceOf(RangeError);
    await expect(persister("nested/file.json", {})).rejects.toBeInstanceOf(RangeError);
    await expect(persister("/etc/passwd", {})).rejects.toBeInstanceOf(RangeError);
  });

  it("rejects empty or non-string filenames", async () => {
    const persister = createDefaultNeonAuditPersister(tmp);
    await expect(persister("", {})).rejects.toBeInstanceOf(TypeError);
    await expect(persister("   ", {})).rejects.toBeInstanceOf(TypeError);
  });
});

describe("neon-audit / assertNeonRecordCarriesQueryText", () => {
  it("returns true on a conformant record", () => {
    const record: McpInvocationRecord = {
      server: "neon",
      tool: "query_render_postgres",
      paramsRedacted: { queryText: NEON_SLOW_QUERY_SQL },
      invokedAt: "2025-01-01T00:00:00.000Z",
      outputRef: "anchor",
      retries: 0,
    };
    expect(assertNeonRecordCarriesQueryText(record)).toBe(true);
  });

  it("throws when the server is not neon", () => {
    const record: McpInvocationRecord = {
      server: "render",
      tool: "list_services",
      paramsRedacted: { queryText: NEON_SLOW_QUERY_SQL },
      invokedAt: "2025-01-01T00:00:00.000Z",
      outputRef: "anchor",
      retries: 0,
    };
    expect(() => assertNeonRecordCarriesQueryText(record)).toThrow(/server === "neon"/);
  });

  it("throws when queryText is missing or empty", () => {
    const base: McpInvocationRecord = {
      server: "neon",
      tool: "query_render_postgres",
      paramsRedacted: {},
      invokedAt: "2025-01-01T00:00:00.000Z",
      outputRef: "anchor",
      retries: 0,
    };
    expect(() => assertNeonRecordCarriesQueryText(base)).toThrow(/Property 22/);
    expect(() =>
      assertNeonRecordCarriesQueryText({ ...base, paramsRedacted: { queryText: "" } }),
    ).toThrow(/Property 22/);
  });
});
