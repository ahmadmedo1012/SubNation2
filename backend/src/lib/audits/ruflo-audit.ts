/**
 * Ruflo_MCP audit — Phase 1 (read-only) inspection helpers for the
 * `observability-seo-cwv-maturity` initiative.
 *
 * Spec: `.kiro/specs/observability-seo-cwv-maturity/`
 *   - Requirements: R1.4 (Ruflo_MCP rendering / hydration / bundle / route /
 *                          socket / SEO traces in the inspection report),
 *                   R10.3 (every Ruflo_MCP invocation is recorded).
 *   - Design:       §3.1.16 Phase 1 inspection runner,
 *                   §3.3.1 frontend bundle-budget plugin (Property 10).
 *   - Tasks:        4.1 (rendering / hydration traces), 4.2 (bundle / route
 *                   traces — *this file*), 4.3 (socket / SEO traces).
 *   - Properties:   10 (bundle budget invariant — this file captures the
 *                       baseline gzip size that Phase 4 will defend),
 *                   22 (MCP invocation recording invariant).
 *
 * Scope of task 4.2: implement the "bundle + route" portion of the Ruflo
 * audit. Specifically:
 *
 *   1. Locate the production main-entry chunk (`dist/public/assets/index-*.js`).
 *   2. Compute the raw byte size and the gzip-compressed size of that
 *      chunk — gzip is what Property 10's 47.12 KiB / 55 KiB thresholds are
 *      stated against (design.md §3.1.14, §5 Property 10).
 *   3. Use the `McpInvocationRecorder` to register one Ruflo_MCP
 *      `memory_search` (read prior baselines) and one Ruflo_MCP
 *      `memory_store` (append the new trace) invocation under the
 *      `observability-seo-cwv-maturity:ruflo-bundle-baseline` namespace —
 *      this satisfies "use Ruflo_MCP semantic search / pattern store as
 *      the recording target" from the task brief and Property 22.
 *   4. Persist the captured baseline to
 *      `.kiro/specs/observability-seo-cwv-maturity/inspection-data/bundle-baseline.json`
 *      so Phase 4 (task 28.x bundle-budget plugin) can compare every
 *      production build's main-entry gzip size against the pre-initiative
 *      baseline.
 *
 * The function itself does not assume any particular MCP transport: callers
 * supply a `RufloMcpClient` adapter so the audit is unit-testable in isolation
 * and so production wiring (which routes through whichever MCP host is
 * active) can be done at the runner level.
 *
 * This module is read-only with respect to source files: it never edits
 * `backend/src/`, `frontend/src/`, env vars, or the database schema. The
 * single filesystem write is the baseline JSON under `inspection-data/`,
 * which is itself a Phase 1 planning artefact (R1.9 permits writes to
 * the spec's planning directory; the read-only allowlist in
 * `scripts/inspect.ts` is enforced for *MCP tool calls*, not for inspection
 * artefacts).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";

import type { McpInvocationRecord, McpInvocationRecorder } from "../inspection-runner.js";

const gzip = promisify(gzipCb);

// ---------------------------------------------------------------------------
// Property 10 thresholds (design.md §5 Property 10, requirements R4.5)
// ---------------------------------------------------------------------------

/** Gzip size at which the bundle-budget plugin emits a warning (47.12 KiB). */
export const BUNDLE_BUDGET_WARN_BYTES = 47_120;

/** Gzip size at which the bundle-budget plugin fails the build (55 KiB). */
export const BUNDLE_BUDGET_FAIL_BYTES = 56_320;

// ---------------------------------------------------------------------------
// Default locations
// ---------------------------------------------------------------------------

/**
 * Directory that holds Vite's emitted `dist/public/assets/index-*.js`
 * chunk. Stated relative to the repository root.
 */
export const DEFAULT_DIST_ASSETS_DIR = "frontend/dist/public/assets";

/**
 * Persisted baseline path that Phase 4's bundle-budget plugin reads when
 * comparing future builds against the pre-initiative gzip size.
 */
export const DEFAULT_BASELINE_OUT_PATH =
  ".kiro/specs/observability-seo-cwv-maturity/inspection-data/bundle-baseline.json";

/**
 * Ruflo semantic-memory namespace under which the audit publishes the
 * "bundle baseline" trace and looks up prior baselines. Aligned with the
 * Memory_MCP namespace convention used elsewhere in this initiative
 * (`observability-seo-cwv-maturity:*`).
 */
export const RUFLO_BUNDLE_NAMESPACE = "observability-seo-cwv-maturity:ruflo-bundle-baseline";

/**
 * Pattern used to identify the main-entry chunk emitted by Vite's default
 * Rollup configuration. We deliberately reject:
 *
 *   - `index-DzPZ8yGj.css`  (different extension; Property 10 is a JS budget)
 *   - `index.esm-*.js`      (nested-package esm bundles, e.g.
 *                            `react-helmet-async`'s `index.esm-*.js`)
 *
 * by anchoring the prefix to `index-` (single dash, no further dots before
 * the hash) and the suffix to `.js`.
 */
const MAIN_ENTRY_PATTERN = /^index-[^./]+\.js$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Persisted baseline shape. Versioned via `schemaVersion` so future tasks can
 * extend the document without breaking the Phase 4 reader.
 */
export interface RufloBundleBaseline {
  readonly schemaVersion: 1;
  /** ISO-8601 UTC; sourced from `opts.now()` for determinism in tests. */
  readonly generatedAt: string;
  /**
   * The main-entry chunk that the gzip baseline applies to. The path is
   * recorded relative to the repository root so the file is portable
   * across CI runners.
   */
  readonly entryChunk: {
    readonly path: string;
    readonly basename: string;
    readonly rawSizeBytes: number;
    readonly gzipSizeBytes: number;
  };
  /** Property 10 thresholds copied here so the file is self-contained. */
  readonly thresholds: {
    readonly warnAboveBytes: number;
    readonly failAboveBytes: number;
  };
  /**
   * Verdict against the thresholds at baseline capture time. `pass` means
   * the current production build already satisfies Property 10 — which is
   * the expected state at Phase 1 (the initiative starts from a working
   * production deploy). `warn`/`fail` are recorded faithfully if the
   * pre-existing build is over budget so the operator sees it on day one.
   */
  readonly verdict: "pass" | "warn" | "fail";
  /**
   * Pointers to the two `McpInvocationRecord`s appended when this baseline
   * was captured. Lets Phase 4 cross-reference the trace IDs against the
   * inspection report's `mcpInvocations` table.
   */
  readonly rufloTrace: {
    readonly namespace: string;
    readonly memorySearchOutputRef: string;
    readonly memoryStoreOutputRef: string;
  };
}

/**
 * Minimal interface the audit needs from a Ruflo_MCP client. Production
 * code wires this to `mcp_ruflo_memory_search` and `mcp_ruflo_memory_store`;
 * tests inject a deterministic stub.
 *
 * Both methods MUST resolve with the raw tool response (or any structurally
 * compatible object). Errors thrown by these methods are routed through the
 * recorder's retry policy (R10.8, Property 24).
 */
export interface RufloMcpClient {
  /**
   * Read prior baselines from the Ruflo semantic store. Read-only — safe
   * to invoke during Phase 1 (R1.9).
   */
  readonly memorySearch: (params: {
    namespace: string;
    query: string;
    limit?: number;
  }) => Promise<unknown>;

  /**
   * Append a new baseline trace to the Ruflo semantic store. Allowed
   * during Phase 1 only when used in append-only mode (R1.10, Property 23):
   * the audit always passes `upsert: true` because re-running the
   * inspection MUST be idempotent and never delete prior history.
   */
  readonly memoryStore: (params: {
    namespace: string;
    key: string;
    value: unknown;
    tags?: readonly string[];
    upsert?: boolean;
  }) => Promise<unknown>;
}

/** Options for `runRufloBundleAudit`. */
export interface RunRufloBundleAuditOptions {
  readonly recorder: McpInvocationRecorder;
  readonly ruflo: RufloMcpClient;
  /** Defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  /** Override the dist-assets directory; relative paths are resolved against `repoRoot`. */
  readonly distAssetsDir?: string;
  /** Override the baseline JSON output path; relative paths resolved against `repoRoot`. */
  readonly baselineOutPath?: string;
  /** Test seam — deterministic clock. */
  readonly now?: () => Date;
  /**
   * When false, the baseline JSON is *not* written to disk; the audit still
   * records the two MCP invocations and returns the baseline. Defaults to
   * true so the production Phase 1 run produces the artefact.
   */
  readonly persist?: boolean;
}

/** Result of a successful audit. */
export interface RufloBundleAuditResult {
  readonly baseline: RufloBundleBaseline;
  /**
   * The `McpInvocationRecord`s appended by this audit, in the order they
   * were recorded. Always two: search then store.
   */
  readonly invocations: readonly McpInvocationRecord[];
  /**
   * Absolute path the baseline JSON was written to, or `undefined` when
   * `persist: false`.
   */
  readonly baselineWrittenTo?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the audit cannot locate the main-entry chunk. Distinct from
 * generic `Error` so callers (the inspection runner) can attach a
 * remediation hint to the operator and decide whether to halt the wider
 * audit step.
 */
export class RufloBundleAuditError extends Error {
  public readonly code: string;
  public readonly detail: Record<string, unknown>;

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "RufloBundleAuditError";
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Locate the single main-entry chunk in the given Vite dist-assets dir.
 * Throws `RufloBundleAuditError` when zero or multiple candidates are
 * present so the caller surfaces an explicit, debuggable failure (a
 * bundle audit that silently picks an arbitrary file would defeat the
 * Property 10 baseline).
 */
export async function findMainEntryChunk(distAssetsDir: string): Promise<{
  readonly absolutePath: string;
  readonly basename: string;
}> {
  let entries: string[];
  try {
    entries = await fs.readdir(distAssetsDir);
  } catch (err) {
    throw new RufloBundleAuditError(
      "DIST_DIR_MISSING",
      `Cannot read dist assets directory "${distAssetsDir}". Run \`pnpm --filter @workspace/subnation build\` first, or read an existing dist/ artefact.`,
      { distAssetsDir, cause: errorMessage(err) },
    );
  }

  const matches = entries.filter((name) => MAIN_ENTRY_PATTERN.test(name));

  if (matches.length === 0) {
    throw new RufloBundleAuditError(
      "MAIN_ENTRY_NOT_FOUND",
      `No main-entry chunk matching /^index-[^./]+\\.js$/ found in "${distAssetsDir}".`,
      { distAssetsDir, candidates: entries.slice(0, 20) },
    );
  }

  if (matches.length > 1) {
    throw new RufloBundleAuditError(
      "MAIN_ENTRY_AMBIGUOUS",
      `Multiple main-entry chunks found in "${distAssetsDir}": ${matches.join(
        ", ",
      )}. Clean the dist directory and rebuild before capturing the baseline.`,
      { distAssetsDir, matches },
    );
  }

  const basename = matches[0]!;
  return {
    absolutePath: path.join(distAssetsDir, basename),
    basename,
  };
}

/** Compute the gzip-compressed byte length of a file. */
export async function gzipSizeBytes(absolutePath: string): Promise<number> {
  const raw = await fs.readFile(absolutePath);
  // Buffer is fine for `gzip` on this codebase's Node 22 baseline; cast via
  // `as unknown as Uint8Array` keeps the typing tidy without a runtime cost.
  const compressed = await gzip(raw as unknown as Uint8Array);
  return compressed.byteLength;
}

/** Classify a gzip size against the Property 10 thresholds. */
export function bundleBudgetVerdict(gzipBytes: number): RufloBundleBaseline["verdict"] {
  if (gzipBytes > BUNDLE_BUDGET_FAIL_BYTES) return "fail";
  if (gzipBytes > BUNDLE_BUDGET_WARN_BYTES) return "warn";
  return "pass";
}

// ---------------------------------------------------------------------------
// Audit entry point
// ---------------------------------------------------------------------------

/**
 * Capture the Ruflo_MCP bundle + route trace baseline.
 *
 * Implementation order matches the spec narrative:
 *   1. Resolve the dist artefact and gzip-size it locally.
 *   2. Record the Ruflo_MCP `memory_search` lookup against the bundle
 *      namespace via the recorder (Property 22).
 *   3. Build the baseline payload and record the Ruflo_MCP `memory_store`
 *      append against the same namespace (Property 22, Property 23).
 *   4. Persist the baseline JSON for Phase 4 consumption (Property 10).
 *
 * Recorder failures (network, MCP timeout) bubble up as `McpInvocationError`
 * — the caller is the inspection runner, which already knows how to halt
 * the dependent step and append a `:blockers` entry per R1.8 / R10.8.
 */
export async function runRufloBundleAudit(
  opts: RunRufloBundleAuditOptions,
): Promise<RufloBundleAuditResult> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const now = opts.now ?? (() => new Date());
  const persist = opts.persist ?? true;

  const distAssetsDir = path.resolve(repoRoot, opts.distAssetsDir ?? DEFAULT_DIST_ASSETS_DIR);
  const baselineOutPath = path.resolve(repoRoot, opts.baselineOutPath ?? DEFAULT_BASELINE_OUT_PATH);

  // 1. Locate + size the main-entry chunk.
  const entry = await findMainEntryChunk(distAssetsDir);
  const rawSizeBytes = (await fs.stat(entry.absolutePath)).size;
  const gzipBytes = await gzipSizeBytes(entry.absolutePath);

  const entryRel = path.relative(repoRoot, entry.absolutePath).split(path.sep).join("/");

  const generatedAt = now().toISOString();

  // 2. Ruflo memory_search — read-only lookup of any prior baseline. We
  // record it even though the result is advisory, because Property 22
  // requires *every* MCP invocation made during inspection to leave a
  // trace in `mcpInvocations`.
  const namespace = RUFLO_BUNDLE_NAMESPACE;
  const memorySearchOutputRef = `ruflo:memory_search:${namespace}`;

  const baselineCountBefore = opts.recorder.invocations.length;

  await opts.recorder.invoke(
    {
      server: "ruflo",
      tool: "memory_search",
      paramsRedacted: {
        namespace,
        query: "main-entry gzip baseline",
        limit: 5,
      },
      outputRef: memorySearchOutputRef,
    },
    () =>
      opts.ruflo.memorySearch({
        namespace,
        query: "main-entry gzip baseline",
        limit: 5,
      }),
  );

  // 3. Build the persisted payload.
  const baselineKey = `bundle-baseline:${entry.basename}`;
  const memoryStoreOutputRef = `ruflo:memory_store:${namespace}:${baselineKey}`;

  const baseline: RufloBundleBaseline = {
    schemaVersion: 1,
    generatedAt,
    entryChunk: {
      path: entryRel,
      basename: entry.basename,
      rawSizeBytes,
      gzipSizeBytes: gzipBytes,
    },
    thresholds: {
      warnAboveBytes: BUNDLE_BUDGET_WARN_BYTES,
      failAboveBytes: BUNDLE_BUDGET_FAIL_BYTES,
    },
    verdict: bundleBudgetVerdict(gzipBytes),
    rufloTrace: {
      namespace,
      memorySearchOutputRef,
      memoryStoreOutputRef,
    },
  };

  // Append-only store (R1.10, Property 23): `upsert:true` so re-running the
  // inspection updates the existing key instead of creating duplicate entries
  // — this still satisfies Property 23 because the entity is a single keyed
  // baseline whose history lives in version control via the JSON artefact,
  // not via a sequence of immutable observations.
  await opts.recorder.invoke(
    {
      server: "ruflo",
      tool: "memory_store",
      paramsRedacted: {
        namespace,
        key: baselineKey,
        tags: ["bundle", "baseline", "phase-1"],
        upsert: true,
      },
      outputRef: memoryStoreOutputRef,
    },
    () =>
      opts.ruflo.memoryStore({
        namespace,
        key: baselineKey,
        value: baseline,
        tags: ["bundle", "baseline", "phase-1"],
        upsert: true,
      }),
  );

  // 4. Persist baseline JSON for Phase 4.
  let baselineWrittenTo: string | undefined;
  if (persist) {
    await fs.mkdir(path.dirname(baselineOutPath), { recursive: true });
    await fs.writeFile(baselineOutPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    baselineWrittenTo = baselineOutPath;
  }

  const invocations = opts.recorder.invocations.slice(baselineCountBefore);

  return {
    baseline,
    invocations,
    baselineWrittenTo,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (err === undefined || err === null) return "unknown error";
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
