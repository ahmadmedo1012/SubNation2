#!/usr/bin/env -S npx tsx
/**
 * Phase 1 Inspection Entry Point — read-only audit runner.
 *
 * Spec: .kiro/specs/observability-seo-cwv-maturity
 *   - Requirements: R1.1–R1.10, R10.1–R10.9
 *   - Design:       §3.1.16 Phase 1 inspection runner
 *   - Tasks:        1.2 (this file), 1.1 (companion `backend/src/lib/inspection-runner.ts`)
 *
 * Responsibilities of this entry point (R1.9):
 *   1. Import `runInspection` from the Phase 1 runner module.
 *   2. Encode the read-only allowlist as constants the runner can consult.
 *   3. Provide guard helpers (`assertReadOnlyToolAllowed`, `assertWritePathAllowed`)
 *      that the runner is expected to call before each MCP invocation and each
 *      filesystem write.
 *   4. Snapshot the working tree and the environment before invoking the runner,
 *      and verify after the run that the only mutations are the two documented
 *      markdown artefacts; anything else is reported as an
 *      `InspectionPolicyError` and the process exits non-zero.
 *
 * Read-only allowlist (R1.9):
 *   - `read_file`
 *   - `grep_search`
 *   - `list_*`     (e.g. Render_MCP `list_services`, `list_deploys`, `list_logs`,
 *                   `list_key_value`, Neon_MCP `list_*`, etc.)
 *   - `get_*`      (e.g. Render_MCP `get_service`, `get_metrics`, `get_postgres`,
 *                   `get_deploy`, etc.)
 *   - `read_*`     (any read-prefixed MCP tool)
 *   - `query-docs` (Context7_MCP — also accepted as `query_docs`)
 *   - Memory_MCP append-only:
 *        `memory_add_observations`, `memory_create_entities`,
 *        `memory_create_relations`, plus the read tools `memory_search_nodes`,
 *        `memory_open_nodes`, `memory_read_graph`.
 *
 * Forbidden during Phase 1:
 *   - Source file mutations anywhere except
 *       `.kiro/specs/observability-seo-cwv-maturity/inspection-report.md`
 *       `.kiro/specs/observability-seo-cwv-maturity/master-execution-plan.md`
 *   - Environment variable mutations (any add / remove / change).
 *   - Deployments (Render_MCP `update_*`, `create_*`, `restart_*`, `delete_*`).
 *   - Database schema or data mutations (Neon_MCP `prepare_database_migration`,
 *     `complete_database_migration`, `run_sql` with mutating SQL).
 *
 * Usage:
 *     pnpm tsx scripts/inspect.ts             # full Phase 1 run
 *     pnpm tsx scripts/inspect.ts --dry-run   # plan only — no Memory_MCP writes
 *     pnpm tsx scripts/inspect.ts --help      # show all options
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  runInspection,
  type InspectionReport,
  type MasterExecutionPlan,
} from "../backend/src/lib/inspection-runner.ts";

// ── Repo root resolution ─────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot: string = path.resolve(here, "..");

// ── Read-only allowlist constants (R1.9) ─────────────────────────────────────

/**
 * Tool-name prefixes that are unconditionally read-only and therefore allowed
 * during Phase 1. Matched case-insensitively against the *bare* tool name (no
 * server prefix), e.g. `list_services`, `get_metrics`, `read_file`.
 *
 * Wildcards are intentionally absent: prefix membership is tested with
 * `startsWith` for explicit, auditable behavior.
 */
export const READ_ONLY_TOOL_PREFIXES: readonly string[] = Object.freeze(["list_", "get_", "read_"]);

/**
 * Exact tool names that are allowed in addition to the prefix matches above.
 */
export const READ_ONLY_TOOL_EXACT: ReadonlySet<string> = new Set([
  // Local read tools
  "read_file",
  "read_files",
  "grep_search",
  "file_search",

  // Context7_MCP documentation tools (R1.5)
  "query-docs",
  "query_docs",
  "resolve-library-id",
  "resolve_library_id",
  "mcp_context7_query_docs",
  "mcp_context7_resolve_library_id",

  // Memory_MCP read tools (R10.6 — non-mutating)
  "memory_read_graph",
  "memory_search_nodes",
  "memory_open_nodes",
]);

/**
 * Memory_MCP tools that are allowed *only* in append mode (R1.6, R1.10, R10.6).
 * The runner MUST NOT call `memory_delete_*` or any tool that overwrites
 * existing observations during Phase 1.
 */
export const MEMORY_MCP_APPEND_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "memory_add_observations",
  "memory_create_entities",
  "memory_create_relations",
]);

/**
 * Tool name prefixes that are *forbidden* during Phase 1 regardless of which
 * MCP server they live on. These are explicit denials so that, even if a tool
 * happens to begin with one of the read-only prefixes by accident, an explicit
 * deny here wins.
 */
export const FORBIDDEN_TOOL_PREFIXES: readonly string[] = Object.freeze([
  "create_",
  "update_",
  "delete_",
  "remove_",
  "restart_",
  "deploy_",
  "set_",
  "write_",
  "patch_",
  "modify_",
  "drop_",
  "reset_",
  "rollback_",
  "run_sql", // Neon_MCP — could be a mutating statement
  "prepare_database_migration",
  "complete_database_migration",
  "memory_delete_",
]);

/**
 * Workspace-relative paths the runner is allowed to write during Phase 1.
 * Anything else triggers `InspectionPolicyError`.
 */
export const READ_ONLY_ALLOWED_WRITE_PATHS: readonly string[] = Object.freeze([
  ".kiro/specs/observability-seo-cwv-maturity/inspection-report.md",
  ".kiro/specs/observability-seo-cwv-maturity/master-execution-plan.md",
]);

/**
 * Workspace-relative directories whose contents the runner is allowed to
 * (over)write during Phase 1. These are read-only audit artefacts produced
 * by the Render/Neon/Ruflo/Context7 audit steps (tasks 2.x–5.x); the
 * persisted JSON enables later sub-tasks to compose the inspection report
 * without re-querying production. Anything written here MUST be deterministic,
 * reproducible from the next inspection run, and free of secret material.
 */
export const READ_ONLY_ALLOWED_WRITE_DIRS: readonly string[] = Object.freeze([
  ".kiro/specs/observability-seo-cwv-maturity/inspection-data",
]);

// ── Policy errors and guard helpers ──────────────────────────────────────────

/**
 * Thrown whenever the runner attempts a tool call or filesystem write that
 * violates the Phase 1 read-only contract (R1.9). The runner should surface
 * this error to the operator and Memory_MCP `:blockers` (R1.8) rather than
 * proceeding.
 */
export class InspectionPolicyError extends Error {
  public readonly code: string;
  public readonly detail: Record<string, unknown>;

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "InspectionPolicyError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Strip an optional MCP-server prefix (e.g. `mcp_render_`, `Render_MCP.`,
 * `render:`) from a tool name so that allowlist matches can be performed on
 * the bare verb. The check is intentionally permissive about the separator
 * because different MCP hosts use different conventions.
 */
function stripServerPrefix(toolName: string): string {
  const lowered = toolName.toLowerCase();
  const knownServerPrefixes = [
    "mcp_render_",
    "mcp_neon_",
    "mcp_ruflo_",
    "mcp_context7_",
    "mcp_memory_",
    "render_mcp_",
    "neon_mcp_",
    "ruflo_mcp_",
    "context7_mcp_",
    "memory_mcp_",
    "render_mcp.",
    "neon_mcp.",
    "ruflo_mcp.",
    "context7_mcp.",
    "memory_mcp.",
    "render:",
    "neon:",
    "ruflo:",
    "context7:",
    "memory:",
  ];
  for (const pfx of knownServerPrefixes) {
    if (lowered.startsWith(pfx)) {
      return lowered.slice(pfx.length);
    }
  }
  return lowered;
}

/**
 * Verify that the given MCP tool name is allowed during Phase 1. Throws
 * `InspectionPolicyError` if it is not.
 *
 * Algorithm:
 *   1. Strip the server prefix.
 *   2. Reject if the bare name starts with any forbidden prefix.
 *   3. Accept if the bare name appears in `READ_ONLY_TOOL_EXACT` or
 *      `MEMORY_MCP_APPEND_ONLY_TOOLS`.
 *   4. Accept if the bare name starts with any read-only prefix.
 *   5. Otherwise reject — the default is deny.
 */
export function assertReadOnlyToolAllowed(toolName: string): void {
  if (typeof toolName !== "string" || toolName.trim() === "") {
    throw new InspectionPolicyError(
      "POLICY_TOOL_INVALID",
      "Inspection runner attempted a tool call with an empty or non-string tool name.",
      { toolName },
    );
  }

  const bare = stripServerPrefix(toolName);

  for (const forbidden of FORBIDDEN_TOOL_PREFIXES) {
    if (bare.startsWith(forbidden)) {
      throw new InspectionPolicyError(
        "POLICY_TOOL_FORBIDDEN",
        `Phase 1 is read-only (R1.9). Tool "${toolName}" is forbidden because it starts with "${forbidden}".`,
        { toolName, bareName: bare, forbiddenPrefix: forbidden },
      );
    }
  }

  if (READ_ONLY_TOOL_EXACT.has(bare) || MEMORY_MCP_APPEND_ONLY_TOOLS.has(bare)) {
    return;
  }

  for (const allowed of READ_ONLY_TOOL_PREFIXES) {
    if (bare.startsWith(allowed)) {
      return;
    }
  }

  throw new InspectionPolicyError(
    "POLICY_TOOL_NOT_ALLOWED",
    `Phase 1 is read-only (R1.9). Tool "${toolName}" is not on the read-only allowlist.`,
    { toolName, bareName: bare, allowedPrefixes: READ_ONLY_TOOL_PREFIXES },
  );
}

/**
 * Verify that the given workspace-relative or absolute path is one of the two
 * allowed Phase 1 write targets. Throws `InspectionPolicyError` otherwise.
 */
export function assertWritePathAllowed(targetPath: string): void {
  if (typeof targetPath !== "string" || targetPath.trim() === "") {
    throw new InspectionPolicyError(
      "POLICY_WRITE_PATH_INVALID",
      "Inspection runner attempted a write with an empty or non-string path.",
      { targetPath },
    );
  }

  const absolute = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(repoRoot, targetPath);
  const relative = path.relative(repoRoot, absolute).split(path.sep).join("/");

  if (relative.startsWith("..")) {
    throw new InspectionPolicyError(
      "POLICY_WRITE_OUT_OF_REPO",
      `Phase 1 may only write inside the repository. Refused: ${targetPath}`,
      { targetPath, absolute, relative },
    );
  }

  if (!READ_ONLY_ALLOWED_WRITE_PATHS.includes(relative)) {
    const insideAllowedDir = READ_ONLY_ALLOWED_WRITE_DIRS.some(
      (dir) => relative === dir || relative.startsWith(dir + "/"),
    );
    if (!insideAllowedDir) {
      throw new InspectionPolicyError(
        "POLICY_WRITE_NOT_ALLOWED",
        `Phase 1 may only write to the documented planning artefacts (R1.9). Refused: ${relative}`,
        {
          targetPath,
          relative,
          allowed: READ_ONLY_ALLOWED_WRITE_PATHS,
          allowedDirs: READ_ONLY_ALLOWED_WRITE_DIRS,
        },
      );
    }
  }
}

// ── Workspace and environment snapshots (post-run verification) ──────────────

interface WorkspaceSnapshot {
  /** Output of `git status --porcelain=v1 -z` parsed into per-path entries. */
  readonly changed: ReadonlyMap<string, string>; // path → status code
  /** True when git is available and the snapshot is reliable. */
  readonly reliable: boolean;
  /** Reason why the snapshot is not reliable, if any. */
  readonly reason?: string;
}

function snapshotWorkspace(): WorkspaceSnapshot {
  try {
    const stdout = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const changed = new Map<string, string>();
    // `-z` separates entries with NUL; each entry is `XY <SP> path`.
    for (const entry of stdout.split("\0")) {
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      const filePath = entry.slice(3);
      if (filePath) {
        changed.set(filePath, code);
      }
    }
    return { changed, reliable: true };
  } catch (err: unknown) {
    return {
      changed: new Map(),
      reliable: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function snapshotEnv(): Record<string, string> {
  // Shallow clone of `process.env` keeps the comparison cheap and safe; values
  // are strings only.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

interface DriftReport {
  unexpectedFiles: string[];
  envAdded: string[];
  envRemoved: string[];
  envChanged: string[];
}

function diffWorkspace(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  if (!after.reliable) {
    // Without a reliable post-snapshot we cannot prove no drift; surface
    // explicitly so the operator decides.
    return ["__post_snapshot_unreliable__"];
  }
  const unexpected: string[] = [];
  const allowed = new Set(READ_ONLY_ALLOWED_WRITE_PATHS);
  for (const [filePath, code] of after.changed.entries()) {
    if (allowed.has(filePath)) continue;
    if (
      READ_ONLY_ALLOWED_WRITE_DIRS.some((dir) => filePath === dir || filePath.startsWith(dir + "/"))
    ) {
      continue;
    }
    if (before.changed.get(filePath) === code) continue; // unchanged since baseline
    unexpected.push(filePath);
  }
  return unexpected;
}

function diffEnv(
  before: Record<string, string>,
  after: Record<string, string>,
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const k of Object.keys(after)) {
    if (!(k in before)) added.push(k);
    else if (before[k] !== after[k]) changed.push(k);
  }
  for (const k of Object.keys(before)) {
    if (!(k in after)) removed.push(k);
  }
  return { added, removed, changed };
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

interface CliOptions {
  dryRun: boolean;
  skipGitCheck: boolean;
  showHelp: boolean;
}

function parseCli(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, skipGitCheck: false, showHelp: false };
  for (const arg of argv) {
    switch (arg) {
      case "--dry-run":
      case "-n":
        opts.dryRun = true;
        break;
      case "--skip-git-check":
        opts.skipGitCheck = true;
        break;
      case "--help":
      case "-h":
        opts.showHelp = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new InspectionPolicyError(
            "CLI_UNKNOWN_FLAG",
            `Unknown flag: ${arg}. Run with --help for usage.`,
            { arg },
          );
        }
    }
  }
  return opts;
}

function printHelp(): void {
  const lines = [
    "Usage: pnpm tsx scripts/inspect.ts [options]",
    "",
    "Phase 1 inspection runner for the observability-seo-cwv-maturity spec.",
    "Read-only by contract (R1.9): no source files, env vars, deploys, or",
    "database schemas are mutated; only the two planning artefacts and",
    "Memory_MCP append-only entities may be written.",
    "",
    "Options:",
    "  -n, --dry-run         Run the audit but skip Memory_MCP writes; the",
    "                        planning artefacts are still produced.",
    "      --skip-git-check  Skip the post-run `git status` verification.",
    "                        Use only when git is unavailable.",
    "  -h, --help            Show this help and exit.",
    "",
    "Allowed tool prefixes: " + READ_ONLY_TOOL_PREFIXES.join(", "),
    "Allowed write targets:",
    ...READ_ONLY_ALLOWED_WRITE_PATHS.map((p) => "  - " + p),
    "Allowed write directories (recursive):",
    ...READ_ONLY_ALLOWED_WRITE_DIRS.map((p) => "  - " + p + "/"),
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

// ── Main entry ───────────────────────────────────────────────────────────────

interface InspectResult {
  readonly report: InspectionReport;
  readonly plan: MasterExecutionPlan;
  readonly drift: DriftReport;
}

/**
 * Read-only policy that the runner is expected to consult before every MCP
 * invocation and every filesystem write. The runner imports this object
 * (rather than a flag on `runInspection`) so the documented `runInspection`
 * signature in design.md §3.1.16 stays narrow and stable.
 */
export const PHASE_1_READ_ONLY_POLICY = Object.freeze({
  repoRoot,
  allowedToolPrefixes: READ_ONLY_TOOL_PREFIXES,
  allowedToolExact: READ_ONLY_TOOL_EXACT,
  memoryAppendOnlyTools: MEMORY_MCP_APPEND_ONLY_TOOLS,
  forbiddenToolPrefixes: FORBIDDEN_TOOL_PREFIXES,
  allowedWritePaths: READ_ONLY_ALLOWED_WRITE_PATHS,
  allowedWriteDirs: READ_ONLY_ALLOWED_WRITE_DIRS,
  assertReadOnlyToolAllowed,
  assertWritePathAllowed,
} as const);

export type Phase1ReadOnlyPolicy = typeof PHASE_1_READ_ONLY_POLICY;

/**
 * Programmatic entry. Returns the inspection report, the master execution
 * plan, and a drift report (filesystem and env-var diffs). The caller is
 * responsible for deciding what to do with non-empty drift; the CLI variant
 * (`main`) treats any drift as a hard failure.
 */
export async function inspect(opts: CliOptions): Promise<InspectResult> {
  const beforeWorkspace = opts.skipGitCheck
    ? ({ changed: new Map(), reliable: false, reason: "skip-git-check" } as WorkspaceSnapshot)
    : snapshotWorkspace();
  const beforeEnv = snapshotEnv();

  const { report, plan } = await runInspection({ dryRun: opts.dryRun });

  const afterWorkspace = opts.skipGitCheck
    ? ({ changed: new Map(), reliable: false, reason: "skip-git-check" } as WorkspaceSnapshot)
    : snapshotWorkspace();
  const afterEnv = snapshotEnv();

  const drift: DriftReport = {
    unexpectedFiles: opts.skipGitCheck ? [] : diffWorkspace(beforeWorkspace, afterWorkspace),
    ...(() => {
      const e = diffEnv(beforeEnv, afterEnv);
      return { envAdded: e.added, envRemoved: e.removed, envChanged: e.changed };
    })(),
  };

  return { report, plan, drift };
}

async function main(): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (err: unknown) {
    if (err instanceof InspectionPolicyError) {
      process.stderr.write(err.message + "\n");
      return 2;
    }
    throw err;
  }

  if (opts.showHelp) {
    printHelp();
    return 0;
  }

  process.stdout.write(`[inspect] Phase 1 read-only audit starting (dryRun=${opts.dryRun})\n`);

  let result: InspectResult;
  try {
    result = await inspect(opts);
  } catch (err: unknown) {
    if (err instanceof InspectionPolicyError) {
      process.stderr.write(
        `[inspect] POLICY VIOLATION (${err.code}): ${err.message}\n` +
          `[inspect] detail: ${JSON.stringify(err.detail)}\n`,
      );
      return 3;
    }
    process.stderr.write(
      `[inspect] runner failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    return 1;
  }

  const { drift } = result;
  const hasDrift =
    drift.unexpectedFiles.length > 0 ||
    drift.envAdded.length > 0 ||
    drift.envRemoved.length > 0 ||
    drift.envChanged.length > 0;

  if (hasDrift) {
    process.stderr.write(
      "[inspect] POLICY VIOLATION (R1.9): unexpected mutations after Phase 1 run.\n" +
        JSON.stringify(drift, null, 2) +
        "\n",
    );
    return 4;
  }

  process.stdout.write(
    `[inspect] Phase 1 complete. ` +
      `MCP invocations recorded: ${result.report.mcpInvocations.length}. ` +
      `Plan phases: ${result.plan.phases.length}.\n`,
  );
  return 0;
}

// Only auto-run when executed as a script (not when imported by tests).
const invokedAsScript = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(
        `[inspect] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
