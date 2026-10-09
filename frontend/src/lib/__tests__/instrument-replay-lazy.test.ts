import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A2 F1 (R124): Session Replay byte-gating — regression tests.
 *
 * The replay recorder (rrweb — ~⅔ of the old 469 KB vendor-sentry chunk)
 * used to ride the SDK chunk EVERY visitor idle-loads. It now lives in
 * src/lib/sentry-replay.ts, the app's ONLY importer of the replay
 * integration, reached exclusively via instrument.ts's dynamic
 * `import("./lib/sentry-replay")`. These tests pin the runtime half of
 * that contract (the build half — vendor-sentry shipping without the
 * rrweb bytes — is guarded by the bundle-budget plugin + the grep-clean
 * lane):
 *
 *   1. `init()` never receives the replay integration or non-zero replay
 *      sample rates — with both `replays*SampleRate` at 0 the
 *      integration would start in manual mode, which is what lets OUR
 *      rolls own recording.
 *   2. A non-winner session attaches the replay chunk lazily on the
 *      FIRST error/fatal-level event (beforeSend, buffer mode), exactly
 *      once; warning-level events never pull the chunk.
 *   3. Sticky session winners (production roll) attach in "session" mode
 *      on SDK boot.
 *   4. sentry-replay.ts maps "session" → start() and "error" →
 *      startBuffering(), preserving the old PII masking config.
 *
 * @sentry/react and ../sentry-replay are mocked (the same mock-module
 * pattern as boot-sentry-dsn-guard.test.ts) so "was the replay chunk
 * pulled?" is observable without loading the real ~150 KB SDK.
 */

const state = vi.hoisted(() => ({
  initOptions: undefined as Record<string, unknown> | undefined,
  attachCalls: [] as string[],
  replayConfig: undefined as Record<string, unknown> | undefined,
  replayStarted: 0,
  replayBuffering: 0,
}));

vi.mock("@sentry/react", () => ({
  init: vi.fn((options: Record<string, unknown>) => {
    state.initOptions = options;
    return undefined;
  }),
  browserTracingIntegration: vi.fn(() => ({ name: "browserTracing" })),
  captureException: vi.fn(),
  captureMessage: vi.fn(() => "test-event-id"),
  withScope: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  // Consumed by src/lib/sentry-replay.ts (imported directly in the
  // attach-mode suite below under this same mock).
  addIntegration: vi.fn(),
  replayIntegration: vi.fn((config: Record<string, unknown>) => {
    state.replayConfig = config;
    return {
      name: "replay",
      start: () => {
        state.replayStarted += 1;
      },
      startBuffering: () => {
        state.replayBuffering += 1;
      },
    };
  }),
}));

vi.mock("../sentry-replay", () => ({
  attachSentryReplay: (mode: string) => {
    state.attachCalls.push(mode);
  },
}));

/** Let the dynamic import() inside attachReplay resolve. */
async function flushDynamicImport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function importInstrument(): Promise<void> {
  await import("../../instrument");
}

/** instrument.ts's init options, re-imported fresh per test. */
async function initOptions(): Promise<Record<string, unknown>> {
  await importInstrument();
  if (!state.initOptions) throw new Error("init() was not called by instrument.ts");
  return state.initOptions;
}

beforeEach(() => {
  state.initOptions = undefined;
  state.attachCalls = [];
  state.replayConfig = undefined;
  state.replayStarted = 0;
  state.replayBuffering = 0;
  vi.resetModules();
  sessionStorage.clear();
  // A DSN-present build flavor: the only flavor in which instrument.ts
  // is ever loaded at runtime (boot-sentry's 97-F6 gate).
  vi.stubEnv("VITE_SENTRY_DSN", "https://public@o0.ingest.sentry.io/0");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("A2 F1: init() ships without the replay integration (byte-gating contract)", () => {
  it("both replay sample rates are 0 (manual mode — our rolls own recording)", async () => {
    const options = await initOptions();
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it("the integrations array carries tracing only — no replay integration", async () => {
    const options = await initOptions();
    const integrations = (options.integrations as { name?: string }[]) ?? [];
    expect(integrations).toHaveLength(1);
    expect(integrations[0]?.name).toBe("browserTracing");
    for (const integration of integrations) {
      expect(String(integration?.name ?? "").toLowerCase()).not.toContain("replay");
    }
  });

  it("a test-mode (non-production) boot is never a session winner — no attach on import", async () => {
    await initOptions();
    await flushDynamicImport();
    expect(state.attachCalls).toEqual([]);
  });
});

describe("A2 F1: beforeSend — error-triggered lazy attach for non-winners", () => {
  it("the first error-level event pulls the replay chunk in buffer mode", async () => {
    const options = await initOptions();
    const beforeSend = options.beforeSend as (event: { level: string }) => { level: string } | null;
    const event = { level: "error" };
    expect(beforeSend(event)).toBe(event);
    await flushDynamicImport();
    expect(state.attachCalls).toEqual(["error"]);
  });

  it("fatal-level events count as error triggers too", async () => {
    const options = await initOptions();
    const beforeSend = options.beforeSend as (event: { level: string }) => unknown;
    beforeSend({ level: "fatal" });
    await flushDynamicImport();
    expect(state.attachCalls).toEqual(["error"]);
  });

  it("the attach is one-shot — a second error does not re-import the chunk", async () => {
    const options = await initOptions();
    const beforeSend = options.beforeSend as (event: { level: string }) => unknown;
    beforeSend({ level: "error" });
    await flushDynamicImport();
    beforeSend({ level: "error" });
    await flushDynamicImport();
    expect(state.attachCalls).toEqual(["error"]);
  });

  it("warning-level events never pull the replay chunk", async () => {
    const options = await initOptions();
    const beforeSend = options.beforeSend as (event: { level: string }) => unknown;
    beforeSend({ level: "warning" });
    await flushDynamicImport();
    expect(state.attachCalls).toEqual([]);
  });
});

describe("A2 F1: sticky session winners attach on SDK boot (production roll)", () => {
  it("a stored winning roll attaches in session mode immediately", async () => {
    vi.stubEnv("MODE", "production");
    sessionStorage.setItem("sn:sentry-replay-roll", "1");
    await initOptions();
    await flushDynamicImport();
    expect(state.attachCalls).toEqual(["session"]);
  });

  it("a stored losing roll attaches nothing until an error arrives", async () => {
    vi.stubEnv("MODE", "production");
    sessionStorage.setItem("sn:sentry-replay-roll", "0");
    const options = await initOptions();
    await flushDynamicImport();
    expect(state.attachCalls).toEqual([]);
    const beforeSend = options.beforeSend as (event: { level: string }) => unknown;
    beforeSend({ level: "error" });
    await flushDynamicImport();
    expect(state.attachCalls).toEqual(["error"]);
  });
});

describe("A2 F1: build-graph severance (vite.config.ts swap — source pin)", () => {
  // The pwa-offline-shell/seo-head-inject pattern: read the real config
  // source from the runner cwd. The swap below is what keeps the rrweb
  // recorder out of vendor-sentry (see sentryDsnGuardPlugin's docblock);
  // if either half drifts, vendor-sentry silently re-absorbs ~300 KB and
  // the byte-gating dies without a test failing — so pin both halves.
  const configText = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

  it("the guard rewrites sentry-replay.ts's replay import off the @sentry/react barrel", () => {
    expect(configText).toContain(
      'import { addIntegration, replayIntegration } from "@sentry/react";',
    );
    expect(configText).toContain('import { replayIntegration } from "@sentry-internal/replay";');
  });

  it("the swap fails LOUDLY if sentry-replay.ts's import shape drifts", () => {
    expect(configText).toMatch(/no longer matches the A2 F1 barrel-import shape/);
  });

  it("the internal replay specifier is resolved to the installed package (not a pinned literal)", () => {
    expect(configText).toContain('requireFromFrontend.resolve("@sentry/react/package.json")');
    // Prettier wraps this call across lines — assert via regex.
    expect(configText).toMatch(
      /createRequire\(sentryBrowserPkg\)\.resolve\(\s*"@sentry-internal\/replay\/package\.json",?\s*\)/,
    );
  });
});

describe("A2 F1: sentry-replay.ts attach modes (the lazy chunk's payload)", () => {
  // vi.importActual: this suite exercises the REAL module — the file-level
  // vi.mock("../sentry-replay") exists for instrument.ts's dynamic import,
  // and would otherwise intercept this direct import too.
  async function realAttach(): Promise<(typeof import("../sentry-replay"))["attachSentryReplay"]> {
    return (await vi.importActual<typeof import("../sentry-replay")>("../sentry-replay"))
      .attachSentryReplay;
  }

  it('"session" mode registers the integration and starts full recording', async () => {
    const attachSentryReplay = await realAttach();
    attachSentryReplay("session");
    expect(state.replayStarted).toBe(1);
    expect(state.replayBuffering).toBe(0);
  });

  it('"error" mode registers the integration and buffers without uploading', async () => {
    const attachSentryReplay = await realAttach();
    attachSentryReplay("error");
    expect(state.replayStarted).toBe(0);
    expect(state.replayBuffering).toBe(1);
  });

  it("PII masking config is preserved from the pre-split integration", async () => {
    const attachSentryReplay = await realAttach();
    attachSentryReplay("session");
    expect(state.replayConfig).toMatchObject({ maskAllText: true, blockAllMedia: true });
  });
});

describe("A2 F1 moves 3+4 (R124): the build-config half of the boundary", () => {
  // Same config-as-text pinning idiom as pwa-offline-shell.test.ts —
  // the runtime suites above prove the app code keeps the lazy path;
  // these pins prove vite.config.ts keeps the two moves that make the
  // LAZY PATH ACTUALLY SAVE BYTES. Without them, an innocent-looking
  // config edit could silently re-merge the recorder into vendor-sentry
  // (measured: 469,777 B with rrweb inside) while every test above
  // still passes — the failure only shows in production byte counts.
  const configPath = resolve(__dirname, "../../../vite.config.ts");
  const config = readFileSync(configPath, "utf8");

  it("move 3: the @sentry/browser barrel strip exists with both replay re-export lines", () => {
    expect(config).toContain(
      `"export { getReplay, replayIntegration } from '@sentry-internal/replay';\\n"`,
    );
    expect(config).toContain(
      `"export { replayCanvasIntegration } from '@sentry-internal/replay-canvas';\\n"`,
    );
    // Scoped to the barrel entry only — side entries (feedbackAsync.js)
    // never carry the lines and must not trip the loud shape error.
    expect(config).toMatch(/build\\\/npm\\\/esm\\\/\(dev\\\/\|prod\\\/\)\?index\\\.js\$/);
  });

  it("move 4: manualChunks pins the recorder package + wrapper into a sentry-replay chunk", () => {
    expect(config).toContain('id.includes("@sentry-internal+replay")');
    expect(config).toContain('id.includes("node_modules/@sentry-internal/replay/")');
    expect(config).toContain('id.endsWith("src/lib/sentry-replay.ts")');
    expect(config).toContain('return "sentry-replay";');
  });

  it("move 4 ordering: the sentry-replay rule precedes the vendor-sentry rule (first match wins)", () => {
    const replayRule = config.indexOf('return "sentry-replay";');
    const vendorRule = config.indexOf('return "vendor-sentry";');
    expect(replayRule).toBeGreaterThan(0);
    expect(vendorRule).toBeGreaterThan(replayRule);
  });
});
