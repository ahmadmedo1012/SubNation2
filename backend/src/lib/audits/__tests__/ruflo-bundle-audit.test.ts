/**
 * Unit tests for `backend/src/lib/audits/ruflo-audit.ts` — the bundle +
 * route trace audit added by task 4.2 of the
 * `observability-seo-cwv-maturity` spec.
 *
 * These tests validate:
 *   - the main-entry chunk is located deterministically (rejecting
 *     ambiguous and missing cases),
 *   - the gzip + verdict computation matches Property 10 thresholds,
 *   - the recorder receives exactly one Ruflo `memory_search` invocation
 *     and one Ruflo `memory_store` invocation per audit (Property 22),
 *   - the persisted baseline JSON has the documented schema and is written
 *     to the spec's `inspection-data/` directory by default,
 *   - recorder retry/halt behavior surfaces on Ruflo failures.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  McpInvocationError,
  McpInvocationRecorder,
  type McpInvocationRecord,
} from "../../inspection-runner";
import {
  BUNDLE_BUDGET_FAIL_BYTES,
  BUNDLE_BUDGET_WARN_BYTES,
  DEFAULT_BASELINE_OUT_PATH,
  DEFAULT_DIST_ASSETS_DIR,
  RUFLO_BUNDLE_NAMESPACE,
  bundleBudgetVerdict,
  findMainEntryChunk,
  gzipSizeBytes,
  runRufloBundleAudit,
  type RufloBundleBaseline,
  type RufloMcpClient,
} from "../ruflo-audit";

const gunzip = promisify(gunzipCb);
const stableNow = () => new Date("2025-01-01T00:00:00.000Z");
const noSleep = async () => {
  /* deterministic */
};

async function makeWorkspace(): Promise<{
  repoRoot: string;
  distAssetsDir: string;
  cleanup: () => Promise<void>;
}> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "ruflo-audit-"));
  const distAssetsDir = path.join(repoRoot, DEFAULT_DIST_ASSETS_DIR);
  await mkdir(distAssetsDir, { recursive: true });
  return {
    repoRoot,
    distAssetsDir,
    cleanup: () => rm(repoRoot, { recursive: true, force: true }),
  };
}

function makeStubRufloClient(): {
  client: RufloMcpClient;
  searchCalls: unknown[];
  storeCalls: unknown[];
} {
  const searchCalls: unknown[] = [];
  const storeCalls: unknown[] = [];
  const client: RufloMcpClient = {
    memorySearch: async (params) => {
      searchCalls.push(params);
      return { results: [] };
    },
    memoryStore: async (params) => {
      storeCalls.push(params);
      return { ok: true };
    },
  };
  return { client, searchCalls, storeCalls };
}

describe("audits/ruflo-audit / pure helpers", () => {
  it("bundleBudgetVerdict classifies sizes against Property 10 thresholds", () => {
    expect(bundleBudgetVerdict(0)).toBe("pass");
    expect(bundleBudgetVerdict(BUNDLE_BUDGET_WARN_BYTES)).toBe("pass");
    expect(bundleBudgetVerdict(BUNDLE_BUDGET_WARN_BYTES + 1)).toBe("warn");
    expect(bundleBudgetVerdict(BUNDLE_BUDGET_FAIL_BYTES)).toBe("warn");
    expect(bundleBudgetVerdict(BUNDLE_BUDGET_FAIL_BYTES + 1)).toBe("fail");
  });

  it("Property 10 thresholds are 47.12 KiB / 55 KiB exactly", () => {
    expect(BUNDLE_BUDGET_WARN_BYTES).toBe(47_120);
    expect(BUNDLE_BUDGET_FAIL_BYTES).toBe(56_320);
  });

  it("findMainEntryChunk locates the single index-*.js file and skips siblings", async () => {
    const ws = await makeWorkspace();
    try {
      // Realistic dist contents (mirrors `frontend/dist/public/assets/`):
      await writeFile(path.join(ws.distAssetsDir, "index-DzPZ8yGj.css"), "");
      await writeFile(path.join(ws.distAssetsDir, "index.esm-Bmk4DcGB.js"), "");
      await writeFile(path.join(ws.distAssetsDir, "vendor-react-abc.js"), "");
      await writeFile(path.join(ws.distAssetsDir, "index-8m7Sdld7.js"), "main");

      const found = await findMainEntryChunk(ws.distAssetsDir);
      expect(found.basename).toBe("index-8m7Sdld7.js");
      expect(path.basename(found.absolutePath)).toBe("index-8m7Sdld7.js");
    } finally {
      await ws.cleanup();
    }
  });

  it("findMainEntryChunk surfaces a typed error when no candidate exists", async () => {
    const ws = await makeWorkspace();
    try {
      await writeFile(path.join(ws.distAssetsDir, "vendor-react-abc.js"), "");
      await expect(findMainEntryChunk(ws.distAssetsDir)).rejects.toMatchObject({
        name: "RufloBundleAuditError",
        code: "MAIN_ENTRY_NOT_FOUND",
      });
    } finally {
      await ws.cleanup();
    }
  });

  it("findMainEntryChunk surfaces a typed error on ambiguous matches", async () => {
    const ws = await makeWorkspace();
    try {
      await writeFile(path.join(ws.distAssetsDir, "index-aaa.js"), "");
      await writeFile(path.join(ws.distAssetsDir, "index-bbb.js"), "");
      await expect(findMainEntryChunk(ws.distAssetsDir)).rejects.toMatchObject({
        name: "RufloBundleAuditError",
        code: "MAIN_ENTRY_AMBIGUOUS",
      });
    } finally {
      await ws.cleanup();
    }
  });

  it("findMainEntryChunk surfaces a typed error when the dist dir is missing", async () => {
    const ws = await makeWorkspace();
    try {
      const missing = path.join(ws.repoRoot, "no-such-dir");
      await expect(findMainEntryChunk(missing)).rejects.toMatchObject({
        name: "RufloBundleAuditError",
        code: "DIST_DIR_MISSING",
      });
    } finally {
      await ws.cleanup();
    }
  });

  it("gzipSizeBytes produces a value smaller than the raw bytes for compressible content", async () => {
    const ws = await makeWorkspace();
    try {
      const file = path.join(ws.distAssetsDir, "index-test.js");
      // ~5 KiB of repeated content compresses very well.
      const raw = "console.log('hello world');".repeat(200);
      await writeFile(file, raw, "utf8");
      const size = await gzipSizeBytes(file);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(Buffer.byteLength(raw));
    } finally {
      await ws.cleanup();
    }
  });
});

describe("audits/ruflo-audit / runRufloBundleAudit", () => {
  it("records exactly one memory_search and one memory_store invocation", async () => {
    const ws = await makeWorkspace();
    try {
      await writeFile(
        path.join(ws.distAssetsDir, "index-fixture.js"),
        "console.log('hi');",
        "utf8",
      );

      const invocations: McpInvocationRecord[] = [];
      const recorder = new McpInvocationRecorder(invocations, {
        sleep: noSleep,
        now: stableNow,
      });
      const { client, searchCalls, storeCalls } = makeStubRufloClient();

      const result = await runRufloBundleAudit({
        recorder,
        ruflo: client,
        repoRoot: ws.repoRoot,
        now: stableNow,
        persist: false,
      });

      expect(result.invocations).toHaveLength(2);
      expect(result.invocations[0]).toMatchObject({
        server: "ruflo",
        tool: "memory_search",
        retries: 0,
      });
      expect(result.invocations[0]?.paramsRedacted).toMatchObject({
        namespace: RUFLO_BUNDLE_NAMESPACE,
      });
      expect(result.invocations[1]).toMatchObject({
        server: "ruflo",
        tool: "memory_store",
        retries: 0,
      });
      expect(result.invocations[1]?.paramsRedacted).toMatchObject({
        namespace: RUFLO_BUNDLE_NAMESPACE,
        upsert: true,
        key: "bundle-baseline:index-fixture.js",
      });
      // Also assert these are the only invocations on the recorder.
      expect(invocations).toHaveLength(2);

      expect(searchCalls).toHaveLength(1);
      expect(storeCalls).toHaveLength(1);
    } finally {
      await ws.cleanup();
    }
  });

  it("memory_store payload is the baseline itself (Property 22 traceability)", async () => {
    const ws = await makeWorkspace();
    try {
      const filePath = path.join(ws.distAssetsDir, "index-fixture.js");
      const content = "console.log('hi');";
      await writeFile(filePath, content, "utf8");

      const recorder = new McpInvocationRecorder([], {
        sleep: noSleep,
        now: stableNow,
      });
      const stored: Array<Record<string, unknown>> = [];
      const client: RufloMcpClient = {
        memorySearch: async () => ({ results: [] }),
        memoryStore: async (params) => {
          stored.push(params as unknown as Record<string, unknown>);
          return { ok: true };
        },
      };

      const { baseline } = await runRufloBundleAudit({
        recorder,
        ruflo: client,
        repoRoot: ws.repoRoot,
        now: stableNow,
        persist: false,
      });

      expect(stored).toHaveLength(1);
      expect(stored[0]?.value).toEqual(baseline);
    } finally {
      await ws.cleanup();
    }
  });

  it("computes the verdict against Property 10 thresholds and embeds the gzip size", async () => {
    const ws = await makeWorkspace();
    try {
      const filePath = path.join(ws.distAssetsDir, "index-fixture.js");
      // Highly compressible content keeps the gzip size < warn threshold.
      await writeFile(filePath, "a".repeat(30_000), "utf8");

      const recorder = new McpInvocationRecorder([], {
        sleep: noSleep,
        now: stableNow,
      });
      const { client } = makeStubRufloClient();

      const { baseline } = await runRufloBundleAudit({
        recorder,
        ruflo: client,
        repoRoot: ws.repoRoot,
        now: stableNow,
        persist: false,
      });

      expect(baseline.entryChunk.basename).toBe("index-fixture.js");
      expect(baseline.entryChunk.rawSizeBytes).toBe(30_000);
      expect(baseline.entryChunk.gzipSizeBytes).toBeGreaterThan(0);
      expect(baseline.entryChunk.gzipSizeBytes).toBeLessThan(BUNDLE_BUDGET_WARN_BYTES);
      expect(baseline.verdict).toBe("pass");
      expect(baseline.thresholds).toEqual({
        warnAboveBytes: BUNDLE_BUDGET_WARN_BYTES,
        failAboveBytes: BUNDLE_BUDGET_FAIL_BYTES,
      });
      expect(baseline.generatedAt).toBe("2025-01-01T00:00:00.000Z");
      expect(baseline.schemaVersion).toBe(1);
      // Path is recorded relative and POSIX-normalized so CI runners are
      // portable.
      expect(baseline.entryChunk.path).toBe(`${DEFAULT_DIST_ASSETS_DIR}/index-fixture.js`);
    } finally {
      await ws.cleanup();
    }
  });

  it("persists the baseline JSON to the spec inspection-data directory by default", async () => {
    const ws = await makeWorkspace();
    try {
      await writeFile(
        path.join(ws.distAssetsDir, "index-fixture.js"),
        "console.log('hi');",
        "utf8",
      );

      const recorder = new McpInvocationRecorder([], {
        sleep: noSleep,
        now: stableNow,
      });
      const { client } = makeStubRufloClient();

      const { baseline, baselineWrittenTo } = await runRufloBundleAudit({
        recorder,
        ruflo: client,
        repoRoot: ws.repoRoot,
        now: stableNow,
      });

      const expected = path.join(ws.repoRoot, DEFAULT_BASELINE_OUT_PATH);
      expect(baselineWrittenTo).toBe(expected);

      const written = await readFile(expected, "utf8");
      const parsed = JSON.parse(written) as RufloBundleBaseline;
      expect(parsed).toEqual(baseline);
      // Trailing newline keeps the file POSIX-friendly.
      expect(written.endsWith("\n")).toBe(true);
    } finally {
      await ws.cleanup();
    }
  });

  it("recorder failure on memory_search halts the audit before any memory_store call", async () => {
    const ws = await makeWorkspace();
    try {
      await writeFile(
        path.join(ws.distAssetsDir, "index-fixture.js"),
        "console.log('hi');",
        "utf8",
      );

      const recorder = new McpInvocationRecorder([], {
        // Tight policy so the test runs fast.
        policy: { backoffsMs: [0, 0, 0], cumulativeBudgetMs: 0 },
        sleep: noSleep,
        now: stableNow,
      });
      let storeCalled = false;
      const client: RufloMcpClient = {
        memorySearch: async () => {
          throw new Error("ruflo unreachable");
        },
        memoryStore: async () => {
          storeCalled = true;
          return { ok: true };
        },
      };

      await expect(
        runRufloBundleAudit({
          recorder,
          ruflo: client,
          repoRoot: ws.repoRoot,
          now: stableNow,
          persist: false,
        }),
      ).rejects.toBeInstanceOf(McpInvocationError);

      expect(storeCalled).toBe(false);
      // The failed invocation is still recorded — Property 22.
      expect(recorder.invocations).toHaveLength(1);
      expect(recorder.invocations[0]).toMatchObject({
        server: "ruflo",
        tool: "memory_search",
      });
    } finally {
      await ws.cleanup();
    }
  });

  it("gzip size matches a fresh round-trip of the file content", async () => {
    // Sanity-check: the audit's gzipSizeBytes should match the size of a
    // gzip-then-gunzip round-trip of the same bytes.
    const ws = await makeWorkspace();
    try {
      const filePath = path.join(ws.distAssetsDir, "index-fixture.js");
      const raw = "console.log('hello sub-nation');".repeat(50);
      await writeFile(filePath, raw, "utf8");

      const size = await gzipSizeBytes(filePath);
      expect(size).toBeGreaterThan(0);

      // Round-trip: gzip the original raw, then gunzip and compare bytes.
      const { gzip: gzipCb } = await import("node:zlib");
      const gzip = promisify(gzipCb);
      const gz = await gzip(Buffer.from(raw, "utf8") as unknown as Uint8Array);
      const round = await gunzip(gz as unknown as Uint8Array);
      expect(round.toString("utf8")).toBe(raw);
      expect(gz.byteLength).toBe(size);
    } finally {
      await ws.cleanup();
    }
  });
});
