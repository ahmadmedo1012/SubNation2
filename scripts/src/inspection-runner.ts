/**
 * Phase 1 inspection runner.
 *
 * Spec: `.kiro/specs/observability-seo-cwv-maturity/design.md` §3.1.16, §4.9.
 * Requirements: R1.1, R1.7, R1.8, R10.1–R10.5, R10.8.
 * Properties:    22 (MCP invocation recording invariant),
 *                24 (MCP retry policy invariant).
 *
 * This file defines the in-memory data model used by the read-only Phase 1
 * runner that produces `inspection-report.md` and `master-execution-plan.md`,
 * exposes the `runInspection` entry point, and provides the MCP invocation
 * recorder + retry policy that every subsequent Phase 1 audit step
 * (Render_MCP, Neon_MCP, Ruflo_MCP, Context7_MCP, Memory_MCP) MUST route
 * its tool calls through.
 *
 * Scope of task 1.3: add the recorder + retry policy on top of the
 * task-1.1 skeleton. No audit steps, Markdown emitters, or Memory_MCP
 * persistence are wired here — those land in tasks 2.x through 6.x.
 */

// ---------------------------------------------------------------------------
// §3.1.16 — InspectionReport
// ---------------------------------------------------------------------------

/**
 * Snapshot of the live production stack as observed by the read-only
 * Phase 1 runner. Serialized to `inspection-report.md` via a separate
 * emitter (Phase 1, later sub-tasks).
 */
export interface InspectionReport {
  generatedAt: string;
  techStack: Record<string, string>; // name → version
  pinoState: { configured: boolean; redactPaths: string[] };
  sentryState: {
    backendInitialized: boolean;
    frontendInitialized: boolean;
    releaseTracking: boolean;
  };
  healthEndpoints: { path: string; present: boolean; behavior: string }[];
  metricsState: { exposed: boolean; endpoint?: string };
  seoState: {
    robots: boolean;
    sitemap: boolean;
    canonical: boolean;
    structuredData: string[];
  };
  cwvBaseline: { lighthouseMobile?: number; lighthouseDesktop?: number };
  monitoringCoverage: string[];
  alertingCoverage: string[];
  redisObservability: string[];
  neonObservability: string[];
  workerObservability: string[];
  socketObservability: string[];
  apiPerfVisibility: string[];
  /** R10.1–R10.5 — every MCP call made during inspection is recorded here. */
  mcpInvocations: McpInvocationRecord[];
  knownFragilities: string[];
}

// ---------------------------------------------------------------------------
// §3.1.16 — McpInvocationRecord
// ---------------------------------------------------------------------------

/**
 * One row per MCP tool invocation made by the inspection runner or the
 * Phase 7 validation suite. The recording fields are mandated by R10.1–R10.5
 * and verified by Property 22 (MCP invocation recording invariant) and
 * Property 25 (MCP coverage gate invariant).
 *
 * For Neon invocations, `paramsRedacted.queryText` MUST contain the exact
 * SQL executed (R10.2). For Context7 invocations, the resolved library ID
 * and query text are required (R10.4).
 */
export interface McpInvocationRecord {
  server: "render" | "neon" | "ruflo" | "context7" | "memory";
  tool: string;
  paramsRedacted: Record<string, unknown>;
  /** ISO-8601 UTC timestamp. */
  invokedAt: string;
  /** Path or anchor to the captured output (e.g. report section anchor). */
  outputRef: string;
  retries: number;
}

// ---------------------------------------------------------------------------
// §3.1.16, §4.9 — MasterExecutionPlan
// ---------------------------------------------------------------------------

/**
 * Phase 2 through Phase 8 plan emitted alongside the inspection report.
 * Serialized to `master-execution-plan.md`.
 */
export interface MasterExecutionPlan {
  phases: Array<{
    phase: 2 | 3 | 4 | 5 | 6 | 7 | 8;
    title: string;
    tasks: string[];
    validationGates: string[];
    rollback: string;
  }>;
}

// ---------------------------------------------------------------------------
// §3.1.16, §6.5 — MCP retry policy (R10.8, Property 24)
// ---------------------------------------------------------------------------

/**
 * Backoff schedule and cumulative-wait budget enforced by
 * `McpInvocationRecorder.invoke`. The defaults match the task-1.3 contract
 * verbatim: 1 s / 5 s / 15 s waits between retries, total wait ≤ 30 s
 * (actual maximum with the default schedule is 21 s, well under the cap).
 *
 * The schedule encodes the wait *before* each retry — i.e. the wait between
 * attempt N and attempt N+1. With a 3-element schedule the runner performs
 * up to 1 initial attempt + 3 retries = 4 attempts maximum, satisfying
 * Property 24 ("retry at most 3 times").
 */
export interface McpRetryPolicy {
  /** Wait in milliseconds before each retry. Order matters. */
  readonly backoffsMs: readonly number[];
  /** Hard cap on the *cumulative* time spent sleeping between retries. */
  readonly cumulativeBudgetMs: number;
}

export const DEFAULT_MCP_RETRY_POLICY: McpRetryPolicy = Object.freeze({
  backoffsMs: Object.freeze([1_000, 5_000, 15_000]),
  cumulativeBudgetMs: 30_000,
}) as McpRetryPolicy;

// ---------------------------------------------------------------------------
// MCP invocation recorder (R10.1–R10.5, R10.8 — Properties 22 + 24)
// ---------------------------------------------------------------------------

/**
 * Description of an MCP tool call the runner is about to perform. Mirrors
 * the recorded fields in `McpInvocationRecord` (R10.1–R10.5).
 *
 * `paramsRedacted` MUST already have any secret material censored by the
 * caller — the recorder does not re-scan parameters. For Neon calls, set
 * `paramsRedacted.queryText` to the exact SQL (R10.2). For Context7 calls,
 * set `paramsRedacted.libraryId` and `paramsRedacted.query` (R10.4).
 *
 * `outputRef` is optional at descriptor time because the caller often does
 * not know the final anchor until the tool returns; supply it via the
 * `setOutputRef` callback handed to the invocation function or update the
 * record directly afterwards.
 */
export interface McpInvocationDescriptor {
  server: McpInvocationRecord["server"];
  tool: string;
  paramsRedacted: Record<string, unknown>;
  outputRef?: string;
}

/**
 * Structured failure description handed to the configured blocker sink when
 * a call exhausts its retry budget. The shape matches Property 24
 * verbatim: `{ tool, params, error, retries, failedAt }`.
 */
export interface McpInvocationFailure {
  /** Bare tool name (no server prefix), e.g. `list_services`. */
  readonly tool: string;
  /** Logical MCP server the tool belongs to. */
  readonly server: McpInvocationRecord["server"];
  /** Already-redacted parameters as supplied by the caller. */
  readonly params: Record<string, unknown>;
  /** Error message from the final attempt; never includes secrets. */
  readonly error: string;
  /** Number of retries actually performed before giving up. */
  readonly retries: number;
  /** ISO-8601 UTC timestamp captured at the moment of final failure. */
  readonly failedAt: string;
}

/**
 * Sink invoked by the recorder when an MCP call exhausts its retry budget.
 *
 * In production this is wired to `mcp_memory_add_observations` against the
 * `observability-seo-cwv-maturity:blockers` entity (R1.8, R10.8). In tests
 * (and in this skeleton until task 6.x lands) it can be a synchronous
 * in-memory collector.
 *
 * Sinks SHOULD NOT throw; if they do, the recorder swallows the secondary
 * error so that the original `McpInvocationError` is the one the caller
 * sees.
 */
export type McpBlockerSink = (failure: McpInvocationFailure) => void | Promise<void>;

/**
 * Thrown by `McpInvocationRecorder.invoke` once retries are exhausted. The
 * caller — i.e. the audit step orchestrating a sequence of MCP calls —
 * MUST treat this as a hard halt for the dependent step (Property 24).
 */
export class McpInvocationError extends Error {
  public readonly server: McpInvocationRecord["server"];
  public readonly tool: string;
  public readonly retries: number;
  public readonly failedAt: string;
  public readonly cause: unknown;

  constructor(failure: McpInvocationFailure, cause: unknown) {
    super(
      `MCP invocation failed after ${failure.retries} retr${
        failure.retries === 1 ? "y" : "ies"
      }: ${failure.server}.${failure.tool} — ${failure.error}`,
    );
    this.name = "McpInvocationError";
    this.server = failure.server;
    this.tool = failure.tool;
    this.retries = failure.retries;
    this.failedAt = failure.failedAt;
    this.cause = cause;
  }
}

/**
 * Construction options for the recorder. All of these have sensible
 * defaults so production code can call `createMcpInvocationRecorder([])`
 * without ceremony; tests inject deterministic clocks and fast sleepers.
 */
export interface McpInvocationRecorderOptions {
  policy?: McpRetryPolicy;
  /**
   * Sink for blockers emitted on exhausted retries. Defaults to a no-op so
   * that early-phase usage (before the Memory_MCP wiring in task 6.x) does
   * not silently lose data: failures still throw `McpInvocationError` and
   * still leave a record in `report.mcpInvocations`.
   */
  recordBlocker?: McpBlockerSink;
  /** Override for `setTimeout`-based sleeping. */
  sleep?: (ms: number) => Promise<void>;
  /** Override for `Date.now()`/`new Date()`. Returns the *current* moment. */
  now?: () => Date;
}

const noopSink: McpBlockerSink = () => {
  /* default sink — production wiring lands in task 6.x */
};

const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    setTimeout(resolve, ms).unref?.();
  });

const realNow = (): Date => new Date();

/**
 * Drives every MCP tool call made by the Phase 1 runner. Guarantees
 * Property 22 (exactly one `McpInvocationRecord` appended per call) and
 * Property 24 (≤ 3 retries, cumulative wait ≤ 30 s, blocker recorded on
 * exhaustion).
 *
 * The recorder is intentionally agnostic about which MCP host actually
 * performs the call — callers pass a thunk returning the tool's
 * Promise<T>. This keeps the runner testable in isolation and avoids
 * hard-coding any particular MCP transport.
 */
export class McpInvocationRecorder {
  public readonly invocations: McpInvocationRecord[];
  public readonly policy: McpRetryPolicy;

  private readonly recordBlocker: McpBlockerSink;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(invocations: McpInvocationRecord[], options: McpInvocationRecorderOptions = {}) {
    this.invocations = invocations;
    this.policy = options.policy ?? DEFAULT_MCP_RETRY_POLICY;
    this.recordBlocker = options.recordBlocker ?? noopSink;
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? realNow;

    if (this.policy.cumulativeBudgetMs < 0) {
      throw new RangeError(
        `McpRetryPolicy.cumulativeBudgetMs must be >= 0 (got ${this.policy.cumulativeBudgetMs}).`,
      );
    }
    for (const ms of this.policy.backoffsMs) {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(
          `McpRetryPolicy.backoffsMs entries must be finite non-negative numbers (got ${ms}).`,
        );
      }
    }
  }

  /**
   * Execute an MCP tool call under the retry policy. Always appends one
   * `McpInvocationRecord` to `invocations` (Property 22). Resolves with
   * the tool's value on success; rejects with `McpInvocationError` on
   * exhaustion (Property 24), having first appended a blocker entry via
   * the configured sink.
   *
   * @param descriptor   What is being invoked (server/tool/paramsRedacted).
   * @param fn           Thunk that performs the actual MCP call. Must
   *                     return a Promise; throws/rejections trigger a
   *                     retry up to the policy's bound.
   * @param onSuccess    Optional hook invoked with the tool's return value
   *                     before the record is appended; the hook MAY return
   *                     a string used as `outputRef` (e.g. a markdown
   *                     anchor produced after writing the result).
   */
  public async invoke<T>(
    descriptor: McpInvocationDescriptor,
    fn: () => Promise<T>,
    onSuccess?: (value: T) => string | undefined,
  ): Promise<T> {
    if (typeof descriptor.tool !== "string" || descriptor.tool.trim() === "") {
      throw new TypeError("McpInvocationDescriptor.tool must be a non-empty string.");
    }

    const invokedAt = this.now().toISOString();
    const paramsRedactedSnapshot: Record<string, unknown> = { ...descriptor.paramsRedacted };

    const backoffs = this.policy.backoffsMs;
    const budget = this.policy.cumulativeBudgetMs;
    let cumulativeWait = 0;
    let lastError: unknown;
    let retries = 0;

    // Initial attempt + up to backoffs.length retries.
    for (let attempt = 0; attempt <= backoffs.length; attempt++) {
      try {
        const value = await fn();

        let outputRef = descriptor.outputRef ?? "";
        if (onSuccess) {
          try {
            const candidate = onSuccess(value);
            if (typeof candidate === "string" && candidate.length > 0) {
              outputRef = candidate;
            }
          } catch {
            // Hook failures must not affect the recorded outcome — we
            // still got a successful tool response.
          }
        }

        this.invocations.push({
          server: descriptor.server,
          tool: descriptor.tool,
          paramsRedacted: paramsRedactedSnapshot,
          invokedAt,
          outputRef,
          retries,
        });
        return value;
      } catch (err) {
        lastError = err;

        // If we have another retry slot, decide whether to sleep or halt
        // because the budget is exhausted.
        const nextBackoff = backoffs[attempt];
        if (nextBackoff === undefined) {
          // No more retries — fall through to exhaustion handling.
          break;
        }

        if (cumulativeWait + nextBackoff > budget) {
          // Honoring the cumulative-wait cap (Property 24) takes precedence
          // over completing the schedule — stop early.
          break;
        }

        await this.sleep(nextBackoff);
        cumulativeWait += nextBackoff;
        retries += 1;
      }
    }

    // Exhausted: record the failed attempt, append the blocker, halt.
    const failedAt = this.now().toISOString();
    const errorMessage = errorToString(lastError);

    this.invocations.push({
      server: descriptor.server,
      tool: descriptor.tool,
      paramsRedacted: paramsRedactedSnapshot,
      invokedAt,
      outputRef: descriptor.outputRef ?? `failed:${descriptor.server}:${descriptor.tool}`,
      retries,
    });

    const failure: McpInvocationFailure = Object.freeze({
      server: descriptor.server,
      tool: descriptor.tool,
      params: paramsRedactedSnapshot,
      error: errorMessage,
      retries,
      failedAt,
    });

    try {
      await this.recordBlocker(failure);
    } catch {
      // The primary failure is what the caller cares about; secondary sink
      // failures are silently swallowed so they cannot mask it. Production
      // wiring should log via Pino on the sink side instead.
    }

    throw new McpInvocationError(failure, lastError);
  }
}

/**
 * Convenience factory equivalent to `new McpInvocationRecorder(...)`.
 * Preferred at call sites that want named-argument readability.
 */
export function createMcpInvocationRecorder(
  invocations: McpInvocationRecord[],
  options?: McpInvocationRecorderOptions,
): McpInvocationRecorder {
  return new McpInvocationRecorder(invocations, options);
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (err === undefined || err === null) return "unknown error";
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RunInspectionOptions {
  /**
   * When true, the runner performs read-only collection and returns the
   * in-memory report and plan, but does NOT write `inspection-report.md`,
   * `master-execution-plan.md`, or any Memory_MCP entity. Default: false.
   *
   * R1.9 (no source mutation during inspection) holds in both modes; the
   * write-vs-no-write distinction is purely about the two markdown
   * deliverables and Memory_MCP appends.
   */
  dryRun?: boolean;

  /**
   * Override the default retry policy. Tests use this to drive failure
   * paths without sleeping for the full 21 s schedule; production code
   * should leave it unset.
   */
  retryPolicy?: McpRetryPolicy;

  /**
   * Sink for blockers (R1.8, R10.8). When omitted the runner constructs a
   * recorder with the no-op sink so that future audit steps (tasks 2.x –
   * 5.x) still produce `McpInvocationRecord` entries even before the
   * Memory_MCP persistence integration in task 6.x is wired.
   */
  recordBlocker?: McpBlockerSink;

  /** Test seam: deterministic sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: deterministic clock. */
  now?: () => Date;
}

export interface RunInspectionResult {
  report: InspectionReport;
  plan: MasterExecutionPlan;
  /**
   * Recorder used by this run. Exposed so audit steps composed on top of
   * `runInspection` (and tests) can introspect retry behavior without
   * having to walk `report.mcpInvocations` manually. Stable across
   * subsequent tasks; new audit steps should call `recorder.invoke(...)`.
   */
  recorder: McpInvocationRecorder;
}

/**
 * Skeleton for the Phase 1 inspection runner.
 *
 * Subsequent sub-tasks fill this in:
 *   • 2.x — Render_MCP audit
 *   • 3.x — Neon_MCP audit
 *   • 4.x — Ruflo_MCP audit
 *   • 5.x — Context7_MCP citations
 *   • 6.x — Memory_MCP persistence and prior-history loading
 *
 * Until those tasks land, this skeleton returns a structurally valid empty
 * report + plan plus a fully-functional `McpInvocationRecorder` so that
 * downstream callers and type-checked tests can be written against the
 * contract. Calling code that asserts MCP coverage (Property 25) will
 * correctly fail against this empty seed.
 */
export async function runInspection(opts: RunInspectionOptions): Promise<RunInspectionResult> {
  const _dryRun = opts.dryRun ?? false;
  // _dryRun is intentionally read-only; the writing logic that consumes it
  // is implemented in later sub-tasks. Reference it to keep the parameter
  // documented and lint-clean while remaining a no-op here.
  void _dryRun;

  const report: InspectionReport = {
    generatedAt: new Date().toISOString(),
    techStack: {},
    pinoState: { configured: false, redactPaths: [] },
    sentryState: {
      backendInitialized: false,
      frontendInitialized: false,
      releaseTracking: false,
    },
    healthEndpoints: [],
    metricsState: { exposed: false },
    seoState: {
      robots: false,
      sitemap: false,
      canonical: false,
      structuredData: [],
    },
    cwvBaseline: {},
    monitoringCoverage: [],
    alertingCoverage: [],
    redisObservability: [],
    neonObservability: [],
    workerObservability: [],
    socketObservability: [],
    apiPerfVisibility: [],
    mcpInvocations: [],
    knownFragilities: [],
  };

  const plan: MasterExecutionPlan = {
    phases: [],
  };

  const recorder = createMcpInvocationRecorder(report.mcpInvocations, {
    policy: opts.retryPolicy,
    recordBlocker: opts.recordBlocker,
    sleep: opts.sleep,
    now: opts.now,
  });

  return { report, plan, recorder };
}
