/**
 * Phase 1 Neon_MCP audit — slow-query sampling, index summary, and
 * connection summary.
 *
 * Spec: `.kiro/specs/observability-seo-cwv-maturity`
 *   - Requirements: R1.3 (Neon evidence), R10.2 (Neon recording rule).
 *   - Design:       §3.1.16 Phase 1 inspection runner; §4.9 Master Plan.
 *   - Properties:   22 (MCP invocation recording invariant — Neon clause).
 *   - Tasks:        3.1 (slow-query sampling + index summary, this file)
 *                   3.2 (connection summary + in-flight query identification,
 *                        appended below the task 3.1 surface — additive only,
 *                        no behavior change to the task-3.1 contract).
 *
 * Scope of task 3.1
 * -----------------
 * Drive the Neon slow-query sampling and the index summary through the
 * read-only Phase 1 recorder so that:
 *
 *   1. Each invocation appends exactly one `McpInvocationRecord` whose
 *      `paramsRedacted.queryText` field contains the **exact SQL string**
 *      executed against the production database (Property 22, Neon clause).
 *   2. The captured rows are persisted as JSON under
 *      `.kiro/specs/observability-seo-cwv-maturity/inspection-data/`
 *      so later sub-tasks (3.2 connection summary, 7.x report emission)
 *      can re-read them without re-querying production.
 *   3. The audit is transport-agnostic: it accepts a `runQuery` callable
 *      that performs the actual MCP call so this module can be unit-tested
 *      in isolation and wired to either `mcp_render_query_render_postgres`
 *      or a future dedicated Neon_MCP tool without code changes here.
 *
 * Phase 1 read-only contract
 * --------------------------
 * The two SQL statements below target only `pg_catalog`/`pg_stat_*` views
 * and never mutate the database. Both are constants — there is no string
 * interpolation and therefore no SQL injection surface — and both fit the
 * "list_/get_/read_" semantic prefix family the runner allowlist covers.
 *
 * If `pg_stat_statements` is not installed in the target database the
 * `runQuery` thunk will throw; the recorder applies its retry policy
 * (DEFAULT_MCP_RETRY_POLICY: 1 s / 5 s / 15 s, 21 s cumulative) and on
 * exhaustion emits a blocker entry per Property 24. No partial writes are
 * left behind because persistence runs only after a successful invocation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { McpInvocationRecord, McpInvocationRecorder } from "../inspection-runner.ts";

// ---------------------------------------------------------------------------
// SQL constants (R1.3, R10.2, Property 22 Neon clause)
// ---------------------------------------------------------------------------

/**
 * Top-20 statements ordered by total execution time. Matches the example SQL
 * in tasks.md §3.1 verbatim so the recorded `paramsRedacted.queryText` is the
 * exact string the recorder transmits to the Neon-side MCP tool.
 *
 * Requires the `pg_stat_statements` extension. On Neon free tier the
 * extension is preinstalled but not loaded by default; if loading is
 * unavailable the runner halts via the standard retry-then-blocker path.
 */
export const NEON_SLOW_QUERY_SQL =
  "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20";

/**
 * Per-index activity counters across all user (non-system) schemas. Matches
 * the example SQL in tasks.md §3.1 verbatim. Read-only; safe on every
 * Postgres role with `pg_read_all_stats` (Neon's default reader role).
 */
export const NEON_INDEX_SUMMARY_SQL = "SELECT * FROM pg_stat_user_indexes";

// ---------------------------------------------------------------------------
// Runner / persister contracts
// ---------------------------------------------------------------------------

/**
 * Adapter that performs the actual SQL execution against Neon, returning
 * a row array. The audit module is intentionally agnostic about which MCP
 * tool ultimately runs the query — production code typically wires this to
 * `mcp_render_query_render_postgres` (since SubNation's Postgres lives on
 * Render's Neon offering); tests inject deterministic stubs.
 *
 * Runners SHOULD reject on any non-2xx tool response so the recorder can
 * apply its retry policy. Returning an empty array on success is allowed
 * and indicates the view is reachable but currently produces no rows
 * (e.g. the database has not received traffic since `pg_stat_statements`
 * was last reset).
 */
export type NeonAuditRunQuery = (sql: string) => Promise<readonly NeonAuditRow[]>;

/** A single row returned by a `pg_stat_*` view. Values are JSON-serialisable. */
export type NeonAuditRow = Readonly<Record<string, unknown>>;

/**
 * Persists captured rows + metadata as JSON. Returns the workspace-relative
 * path written so it can be used as `McpInvocationRecord.outputRef`
 * (Property 22).
 *
 * Implementations MUST create intermediate directories as needed and MUST
 * NOT throw when called twice with the same filename — the audit is
 * idempotent and re-running it should overwrite the previous capture.
 */
export type NeonAuditPersister = (filename: string, payload: unknown) => Promise<string>;

// ---------------------------------------------------------------------------
// Default filesystem persister (R1.3 deliverable target)
// ---------------------------------------------------------------------------

/**
 * Workspace-relative directory where Phase 1 audit findings are written.
 * Mirrored in `scripts/inspect.ts` (`READ_ONLY_ALLOWED_WRITE_DIRS`) so the
 * post-run drift check accepts these files as legitimate Phase 1 output.
 */
export const NEON_AUDIT_OUTPUT_DIR = ".kiro/specs/observability-seo-cwv-maturity/inspection-data";

/**
 * Build a persister rooted at `repoRoot`. Writes are atomic in the sense
 * that the JSON is fully serialised before `writeFile` is invoked; partial
 * writes only occur if the OS aborts mid-syscall, which is acceptable for
 * a read-only audit artefact (the run can simply be repeated).
 */
export function createDefaultNeonAuditPersister(repoRoot: string): NeonAuditPersister {
  const targetDir = path.resolve(repoRoot, NEON_AUDIT_OUTPUT_DIR);
  return async (filename, payload) => {
    if (typeof filename !== "string" || filename.trim() === "") {
      throw new TypeError("NeonAuditPersister: filename must be a non-empty string.");
    }
    if (filename.includes("/") || filename.includes("..") || path.isAbsolute(filename)) {
      throw new RangeError(
        `NeonAuditPersister: filename must be a bare basename (got ${JSON.stringify(filename)}).`,
      );
    }
    await mkdir(targetDir, { recursive: true });
    const absolute = path.join(targetDir, filename);
    const json = JSON.stringify(payload, null, 2) + "\n";
    await writeFile(absolute, json, { encoding: "utf8" });
    return path.posix.join(NEON_AUDIT_OUTPUT_DIR, filename);
  };
}

// ---------------------------------------------------------------------------
// Finding shapes (used by tasks 3.2 and 7.x to emit the inspection report)
// ---------------------------------------------------------------------------

export interface NeonSlowQueryFinding {
  /** ISO-8601 UTC timestamp of when the audit ran. */
  capturedAt: string;
  /** Exact SQL transmitted to the Neon-side tool (Property 22). */
  queryText: string;
  /** Workspace-relative path where the rows were persisted. */
  outputRef: string;
  /** Slow-query sample, truncated to the LIMIT in `queryText`. */
  rows: readonly NeonAuditRow[];
}

export interface NeonIndexSummaryFinding {
  capturedAt: string;
  queryText: string;
  outputRef: string;
  /** All rows from `pg_stat_user_indexes` (no LIMIT in `queryText`). */
  rows: readonly NeonAuditRow[];
}

export interface NeonAuditFindings {
  slowQuerySample: NeonSlowQueryFinding;
  indexSummary: NeonIndexSummaryFinding;
  /**
   * Connection summary added by task 3.2. Optional so existing task-3.1
   * callers / tests that compose `runNeonAudit` continue to type-check
   * without modification. The Phase 1 runner (`scripts/inspect.ts`)
   * populates this field by composing `runNeonConnectionAudit` after
   * `runNeonAudit`.
   */
  connectionSummary?: NeonConnectionSummaryFindings;
}

// ---------------------------------------------------------------------------
// Audit orchestration
// ---------------------------------------------------------------------------

/**
 * Options accepted by the three orchestration entry points below.
 *
 * `toolName` is configurable so the runner can record either
 * `query_render_postgres` (current — Postgres is Render-managed Neon) or a
 * future dedicated Neon_MCP tool without forcing a downstream code change.
 * The default matches the production wiring in `scripts/inspect.ts`.
 */
export interface NeonAuditOptions {
  recorder: McpInvocationRecorder;
  runQuery: NeonAuditRunQuery;
  persister: NeonAuditPersister;
  /** Default: `"query_render_postgres"`. */
  toolName?: string;
  /** Test seam — overrides `Date.now()` for deterministic `capturedAt`. */
  now?: () => Date;
}

const DEFAULT_TOOL_NAME = "query_render_postgres";

const SLOW_QUERY_OUTPUT_FILENAME = "neon-slow-queries.json";
const INDEX_SUMMARY_OUTPUT_FILENAME = "neon-index-summary.json";

/**
 * Run the Neon slow-query sampling step. Records exactly one
 * `McpInvocationRecord` (Property 22) and persists the rows under
 * `inspection-data/neon-slow-queries.json` (R1.3).
 *
 * Throws `McpInvocationError` if the Neon tool fails after the recorder's
 * full retry budget; the caller (the orchestration in §3.2 of this file or
 * the runner in `inspection-runner.ts`) MUST treat that as a hard halt for
 * the dependent step (Property 24).
 */
export async function runNeonSlowQuerySampling(
  options: NeonAuditOptions,
): Promise<NeonSlowQueryFinding> {
  const { recorder, runQuery, persister } = options;
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const now = options.now ?? (() => new Date());

  let outputRef = "";
  let rows: readonly NeonAuditRow[] = [];
  const capturedAt = now().toISOString();

  await recorder.invoke(
    {
      server: "neon",
      tool: toolName,
      // R10.2 / Property 22 — exact SQL stored verbatim in queryText.
      paramsRedacted: { queryText: NEON_SLOW_QUERY_SQL },
    },
    async () => {
      const result = await runQuery(NEON_SLOW_QUERY_SQL);
      rows = freezeRows(result);
      const finding: NeonSlowQueryFinding = {
        capturedAt,
        queryText: NEON_SLOW_QUERY_SQL,
        outputRef: "", // filled below before we hand the result back
        rows,
      };
      outputRef = await persister(SLOW_QUERY_OUTPUT_FILENAME, {
        ...finding,
        // overwrite the empty outputRef placeholder with the real path on
        // disk so consumers reading the JSON see the canonical location
        outputRef: path.posix.join(NEON_AUDIT_OUTPUT_DIR, SLOW_QUERY_OUTPUT_FILENAME),
      });
      return rows;
    },
    () => outputRef,
  );

  return Object.freeze({
    capturedAt,
    queryText: NEON_SLOW_QUERY_SQL,
    outputRef,
    rows,
  });
}

/**
 * Run the Neon index-summary step. Records exactly one
 * `McpInvocationRecord` (Property 22) and persists the rows under
 * `inspection-data/neon-index-summary.json` (R1.3).
 */
export async function runNeonIndexSummary(
  options: NeonAuditOptions,
): Promise<NeonIndexSummaryFinding> {
  const { recorder, runQuery, persister } = options;
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const now = options.now ?? (() => new Date());

  let outputRef = "";
  let rows: readonly NeonAuditRow[] = [];
  const capturedAt = now().toISOString();

  await recorder.invoke(
    {
      server: "neon",
      tool: toolName,
      paramsRedacted: { queryText: NEON_INDEX_SUMMARY_SQL },
    },
    async () => {
      const result = await runQuery(NEON_INDEX_SUMMARY_SQL);
      rows = freezeRows(result);
      const finding: NeonIndexSummaryFinding = {
        capturedAt,
        queryText: NEON_INDEX_SUMMARY_SQL,
        outputRef: "",
        rows,
      };
      outputRef = await persister(INDEX_SUMMARY_OUTPUT_FILENAME, {
        ...finding,
        outputRef: path.posix.join(NEON_AUDIT_OUTPUT_DIR, INDEX_SUMMARY_OUTPUT_FILENAME),
      });
      return rows;
    },
    () => outputRef,
  );

  return Object.freeze({
    capturedAt,
    queryText: NEON_INDEX_SUMMARY_SQL,
    outputRef,
    rows,
  });
}

/**
 * Compose both Neon Phase 1 audit steps in order. The slow-query sampling
 * is run first because it is the higher-signal artefact for the inspection
 * report; the index summary follows. If the slow-query step throws
 * `McpInvocationError`, the index summary is **not** attempted (Property 24
 * — dependent steps halt on blocker).
 *
 * Each step is independent at the recorder level: both produce their own
 * `McpInvocationRecord`. Tasks 3.2 and 7.x consume the returned
 * `NeonAuditFindings` to compose the inspection-report.md narrative.
 */
export async function runNeonAudit(options: NeonAuditOptions): Promise<NeonAuditFindings> {
  const slowQuerySample = await runNeonSlowQuerySampling(options);
  const indexSummary = await runNeonIndexSummary(options);
  return Object.freeze({ slowQuerySample, indexSummary });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freezeRows(rows: readonly NeonAuditRow[]): readonly NeonAuditRow[] {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

/**
 * Convenience: assert that a freshly-appended `McpInvocationRecord` carries
 * the `paramsRedacted.queryText` payload required by Property 22. Useful
 * inside tests and the future Phase 1 validation gate (task 8.x). Returns
 * `true` on conformance; throws `Error` with a descriptive message
 * otherwise so failures are visible in test output.
 */
export function assertNeonRecordCarriesQueryText(record: McpInvocationRecord): true {
  if (record.server !== "neon") {
    throw new Error(
      `Expected McpInvocationRecord.server === "neon", got ${JSON.stringify(record.server)}.`,
    );
  }
  const queryText = record.paramsRedacted["queryText"];
  if (typeof queryText !== "string" || queryText.length === 0) {
    throw new Error(
      "Property 22 (Neon clause) violated: paramsRedacted.queryText must be a non-empty string.",
    );
  }
  return true;
}

// ===========================================================================
// Task 3.2 — Connection summary + in-flight query identification
// ===========================================================================
//
// The two SQL constants below are routed through the same recorder API as
// the task-3.1 statements so each call appends one `McpInvocationRecord`
// with `paramsRedacted.queryText` set to the verbatim SQL (R10.2,
// Property 22). Findings are persisted via the same `NeonAuditPersister`
// contract (R1.3) under `inspection-data/`.
//
// `NEON_CONNECTION_SUMMARY_SQL` returns one row per `pg_stat_activity`
// state (`active`, `idle`, `idle in transaction`, `idle in transaction
// (aborted)`, `fastpath function call`, `disabled`, or NULL for background
// workers / walsender / autovacuum). Bounded result-set size, safe to run
// repeatedly under `mcp_render_query_render_postgres` (which wraps every
// call in a read-only transaction).
//
// `NEON_INFLIGHT_QUERIES_SQL` returns one row per backend whose state is
// not `idle`, excluding the session executing the audit itself. Some
// columns (`query`, `application_name`) can echo application-level
// literals; downstream emitters truncate them defensively.
// ---------------------------------------------------------------------------

/**
 * Connection summary: count of `pg_stat_activity` rows grouped by `state`.
 *
 * Stored verbatim in `paramsRedacted.queryText` on the recorded
 * `McpInvocationRecord` (R10.2, Property 22 — Neon clause).
 */
export const NEON_CONNECTION_SUMMARY_SQL =
  "SELECT state, COUNT(*)::int AS connection_count " +
  "FROM pg_stat_activity " +
  "GROUP BY state " +
  "ORDER BY connection_count DESC NULLS LAST";

/**
 * In-flight query identification — every backend whose state is not
 * `idle`, excluding the audit's own session. `query_start` gives a
 * wall-clock anchor; the computed `duration_ms` saves a parse pass on the
 * consumer side.
 */
export const NEON_INFLIGHT_QUERIES_SQL =
  "SELECT pid, state, query, query_start, state_change, " +
  "datname, usename, application_name, " +
  "EXTRACT(EPOCH FROM (now() - query_start)) * 1000 AS duration_ms " +
  "FROM pg_stat_activity " +
  "WHERE state IS DISTINCT FROM 'idle' " +
  "AND pid <> pg_backend_pid() " +
  "ORDER BY query_start ASC NULLS LAST";

// ---------------------------------------------------------------------------
// Output filenames (mirrored in `READ_ONLY_ALLOWED_WRITE_DIRS`, R1.9)
// ---------------------------------------------------------------------------

const CONNECTION_SUMMARY_OUTPUT_FILENAME = "neon-connection-summary.json";
const INFLIGHT_QUERIES_OUTPUT_FILENAME = "neon-inflight-queries.json";

// ---------------------------------------------------------------------------
// Finding shapes for task 3.2
// ---------------------------------------------------------------------------

/**
 * One row of {@link NEON_CONNECTION_SUMMARY_SQL}. `state` mirrors the
 * Postgres column verbatim and can be `null` for backends in transitional
 * states (e.g. walsender). `connectionCount` is the integer cast of
 * `COUNT(*)`.
 */
export interface NeonConnectionStateRow {
  /** Postgres `pg_stat_activity.state` (nullable). */
  state: string | null;
  /** Integer-cast `COUNT(*)`. Some drivers serialise bigints as strings. */
  connectionCount: number;
}

/**
 * One row of {@link NEON_INFLIGHT_QUERIES_SQL}. All timestamp fields are
 * preserved as ISO-8601 UTC strings (Postgres → JSON casts vary across
 * MCP transports; consumers MAY normalise them).
 */
export interface NeonInFlightQueryRow {
  pid: number;
  state: string | null;
  /**
   * Truncated to {@link MAX_INFLIGHT_QUERY_TEXT_BYTES} on persistence to
   * keep the captured artefact small and to defeat any pathological log
   * payloads that could land in `pg_stat_activity.query`.
   */
  query: string | null;
  queryStart: string | null;
  stateChange: string | null;
  database: string | null;
  user: string | null;
  applicationName: string | null;
  /** Wall-clock duration since `query_start`, in milliseconds. */
  durationMs: number | null;
}

/** Result of the connection-summary step. */
export interface NeonConnectionSummaryFinding {
  capturedAt: string;
  queryText: string;
  outputRef: string;
  /** Sum of `connectionCount` across all `byState` rows. */
  totalConnections: number;
  byState: readonly NeonConnectionStateRow[];
}

/** Result of the in-flight queries step. */
export interface NeonInFlightQueriesFinding {
  capturedAt: string;
  queryText: string;
  outputRef: string;
  /**
   * In-flight queries (state != `idle`) at capture time. Empty when no
   * non-idle backend was running, which is the common case on a quiet
   * production database.
   */
  rows: readonly NeonInFlightQueryRow[];
}

/** Composite findings document for task 3.2. */
export interface NeonConnectionSummaryFindings {
  connectionSummary: NeonConnectionSummaryFinding;
  inFlightQueries: NeonInFlightQueriesFinding;
}

/**
 * Per-row truncation cap for `pg_stat_activity.query` strings persisted
 * to the inspection artefact. 4 KB matches the recorder's general
 * "structured field" budget without forcing aggressive truncation on
 * normal application queries.
 */
export const MAX_INFLIGHT_QUERY_TEXT_BYTES = 4_096;

// ---------------------------------------------------------------------------
// Audit orchestration — connection summary
// ---------------------------------------------------------------------------

/**
 * Run the Neon connection-summary step. Records exactly one
 * `McpInvocationRecord` with `paramsRedacted.queryText` set to
 * {@link NEON_CONNECTION_SUMMARY_SQL} and persists the rows under
 * `inspection-data/neon-connection-summary.json` (R1.3).
 *
 * Throws `McpInvocationError` if the Neon tool fails after the recorder's
 * full retry budget; the caller (the orchestration in `runNeonConnectionAudit`
 * or the runner in `inspection-runner.ts`) MUST treat that as a hard halt
 * for the dependent step (Property 24).
 */
export async function runNeonConnectionSummary(
  options: NeonAuditOptions,
): Promise<NeonConnectionSummaryFinding> {
  const { recorder, runQuery, persister } = options;
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const now = options.now ?? (() => new Date());

  let outputRef = "";
  let byState: readonly NeonConnectionStateRow[] = [];
  let totalConnections = 0;
  const capturedAt = now().toISOString();

  await recorder.invoke(
    {
      server: "neon",
      tool: toolName,
      paramsRedacted: { queryText: NEON_CONNECTION_SUMMARY_SQL },
    },
    async () => {
      const rows = await runQuery(NEON_CONNECTION_SUMMARY_SQL);
      byState = parseConnectionStateRows(rows);
      totalConnections = byState.reduce((sum, row) => sum + row.connectionCount, 0);
      const finding: NeonConnectionSummaryFinding = {
        capturedAt,
        queryText: NEON_CONNECTION_SUMMARY_SQL,
        outputRef: "",
        totalConnections,
        byState,
      };
      outputRef = await persister(CONNECTION_SUMMARY_OUTPUT_FILENAME, {
        ...finding,
        outputRef: path.posix.join(NEON_AUDIT_OUTPUT_DIR, CONNECTION_SUMMARY_OUTPUT_FILENAME),
      });
      return rows;
    },
    () => outputRef,
  );

  return Object.freeze({
    capturedAt,
    queryText: NEON_CONNECTION_SUMMARY_SQL,
    outputRef,
    totalConnections,
    byState: Object.freeze(byState.map((row) => Object.freeze({ ...row }))),
  });
}

/**
 * Run the Neon in-flight queries step. Records exactly one
 * `McpInvocationRecord` with `paramsRedacted.queryText` set to
 * {@link NEON_INFLIGHT_QUERIES_SQL} and persists the rows under
 * `inspection-data/neon-inflight-queries.json` (R1.3).
 */
export async function runNeonInFlightQueries(
  options: NeonAuditOptions,
): Promise<NeonInFlightQueriesFinding> {
  const { recorder, runQuery, persister } = options;
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const now = options.now ?? (() => new Date());

  let outputRef = "";
  let rows: readonly NeonInFlightQueryRow[] = [];
  const capturedAt = now().toISOString();

  await recorder.invoke(
    {
      server: "neon",
      tool: toolName,
      paramsRedacted: { queryText: NEON_INFLIGHT_QUERIES_SQL },
    },
    async () => {
      const raw = await runQuery(NEON_INFLIGHT_QUERIES_SQL);
      rows = parseInFlightQueryRows(raw);
      const finding: NeonInFlightQueriesFinding = {
        capturedAt,
        queryText: NEON_INFLIGHT_QUERIES_SQL,
        outputRef: "",
        rows,
      };
      outputRef = await persister(INFLIGHT_QUERIES_OUTPUT_FILENAME, {
        ...finding,
        outputRef: path.posix.join(NEON_AUDIT_OUTPUT_DIR, INFLIGHT_QUERIES_OUTPUT_FILENAME),
      });
      return raw;
    },
    () => outputRef,
  );

  return Object.freeze({
    capturedAt,
    queryText: NEON_INFLIGHT_QUERIES_SQL,
    outputRef,
    rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
  });
}

/**
 * Compose the two task-3.2 audit steps in order. The connection summary
 * runs first (every Postgres has `pg_stat_activity`); the in-flight queries
 * step follows. If the connection-summary step throws `McpInvocationError`,
 * the in-flight step is **not** attempted (Property 24).
 *
 * Each step is independent at the recorder level: both produce their own
 * `McpInvocationRecord`. Task 7.x consumes the returned
 * `NeonConnectionSummaryFindings` to compose the inspection-report.md
 * narrative.
 */
export async function runNeonConnectionAudit(
  options: NeonAuditOptions,
): Promise<NeonConnectionSummaryFindings> {
  const connectionSummary = await runNeonConnectionSummary(options);
  const inFlightQueries = await runNeonInFlightQueries(options);
  return Object.freeze({ connectionSummary, inFlightQueries });
}

// ---------------------------------------------------------------------------
// Result parsers — exported for tests and downstream report emitters
// ---------------------------------------------------------------------------

/**
 * Parse the rows returned by {@link NEON_CONNECTION_SUMMARY_SQL} into the
 * structured row shape consumed by the inspection report. Tolerates the
 * common transport quirks: bigint counts encoded as strings, numeric
 * counts arriving as plain numbers, and an alternate `count` alias from
 * raw `count(*)` (no `AS connection_count`) outputs.
 */
export function parseConnectionStateRows(
  raw: readonly NeonAuditRow[] | unknown,
): NeonConnectionStateRow[] {
  return rowsOf(raw).map<NeonConnectionStateRow>((row) => {
    const state = neonStringOrNull(row["state"]);
    const rawCount = row["connection_count"] ?? row["count"];
    const connectionCount = neonNumberOrZero(rawCount);
    return { state, connectionCount };
  });
}

/**
 * Parse the rows returned by {@link NEON_INFLIGHT_QUERIES_SQL} into the
 * structured row shape persisted to `inspection-data/`. Truncates each
 * `query` body to {@link MAX_INFLIGHT_QUERY_TEXT_BYTES} defensively.
 */
export function parseInFlightQueryRows(
  raw: readonly NeonAuditRow[] | unknown,
): NeonInFlightQueryRow[] {
  return rowsOf(raw).map<NeonInFlightQueryRow>((row) => ({
    pid: neonNumberOrZero(row["pid"]),
    state: neonStringOrNull(row["state"]),
    query: neonTruncate(neonStringOrNull(row["query"]), MAX_INFLIGHT_QUERY_TEXT_BYTES),
    queryStart: neonTimestampOrNull(row["query_start"]),
    stateChange: neonTimestampOrNull(row["state_change"]),
    database: neonStringOrNull(row["datname"]),
    user: neonStringOrNull(row["usename"]),
    applicationName: neonStringOrNull(row["application_name"]),
    durationMs: neonNumberOrNull(row["duration_ms"]),
  }));
}

// ---------------------------------------------------------------------------
// Internal coercion helpers (task 3.2 only — prefixed `neon` to keep the
// existing module surface stable).
// ---------------------------------------------------------------------------

function rowsOf(raw: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(neonIsPlainObject);
  }
  if (neonIsPlainObject(raw)) {
    const candidate = (raw as { rows?: unknown }).rows;
    if (Array.isArray(candidate)) return candidate.filter(neonIsPlainObject);
  }
  return [];
}

function neonIsPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function neonStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function neonNumberOrZero(value: unknown): number {
  const n = neonNumberOrNull(value);
  return n === null ? 0 : n;
}

function neonNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function neonTimestampOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function neonTruncate(value: string | null, maxBytes: number): string | null {
  if (value === null) return null;
  if (value.length <= maxBytes) return value;
  return `${value.slice(0, maxBytes - 1)}…`;
}
