/**
 * R118-B5 bonus — boot warning for split-era origin env vars
 * (warnLegacySplitOriginEnvAtBoot, lib/origins.ts).
 *
 * Restored by R117 (commit 8acba4a) after the R116 overhaul deleted it
 * accidentally — and it has NEVER had a test (verified R118-A5). The
 * function is the silent-misconfiguration guard for the retired
 * Render/Vercel split stack: an operator copying an old env block
 * (VERCEL_FRONTEND_ORIGIN / FRONTEND_ORIGINS set) re-arms the
 * cross-origin cookie class silently, so boot says so, once, naming
 * only the VAR NAMES (never values).
 *
 * Pinned contract:
 *   1. A split-era var set → exactly ONE logger.warn with
 *      category:"deployment" listing ONLY the var names (never values).
 *   2. Healthy single-origin env (APP_ORIGINS only) → zero warns.
 *   3. The hasAppOrigins flag is reported truthfully in both shapes.
 *   4. Whitespace-only split-era values are treated as unset.
 *
 * The logger is spied (vi.spyOn) per the openwa.service.test.ts
 * precedent — the real pino stream stays untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("../logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), child: vi.fn(() => ({ warn, info: vi.fn(), error: vi.fn() })) },
}));

import { warnLegacySplitOriginEnvAtBoot } from "../origins";

const ENV_KEYS = ["VERCEL_FRONTEND_ORIGIN", "FRONTEND_ORIGINS", "APP_ORIGINS"] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("warnLegacySplitOriginEnvAtBoot — split-era env vars are loudly folded in (R118)", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    warn.mockClear();
  });
  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it("warns exactly once, naming ONLY the var names (never values), when a split-era var is set", () => {
    process.env.VERCEL_FRONTEND_ORIGIN = "https://legacy-frontend.example.com";
    process.env.APP_ORIGINS = "https://subnation.ly";

    warnLegacySplitOriginEnvAtBoot();

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, message] = warn.mock.calls[0]! as [
      { category: string; splitEraVars: string[]; hasAppOrigins: boolean },
      string,
    ];
    expect(fields.category).toBe("deployment");
    expect(fields.splitEraVars).toEqual(["VERCEL_FRONTEND_ORIGIN"]);
    expect(fields.hasAppOrigins).toBe(true);
    expect(message).toContain("split-era origin env vars");
    // The secret-ish VALUE must never leak into the log line — only names.
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain("legacy-frontend.example.com");
  });

  it("is silent on the healthy single-origin shape (APP_ORIGINS alone)", () => {
    process.env.APP_ORIGINS = "https://subnation.ly";

    warnLegacySplitOriginEnvAtBoot();

    expect(warn).not.toHaveBeenCalled();
  });

  it("is silent when split-era vars are present but empty/whitespace", () => {
    process.env.VERCEL_FRONTEND_ORIGIN = "   ";
    process.env.FRONTEND_ORIGINS = "";

    warnLegacySplitOriginEnvAtBoot();

    expect(warn).not.toHaveBeenCalled();
  });

  it("reports hasAppOrigins:false and BOTH var names in the dual split-era shape", () => {
    process.env.VERCEL_FRONTEND_ORIGIN = "https://a.example.com";
    process.env.FRONTEND_ORIGINS = "https://b.example.com";

    warnLegacySplitOriginEnvAtBoot();

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0]! as [
      { splitEraVars: string[]; hasAppOrigins: boolean },
      string,
    ];
    expect(fields.splitEraVars).toEqual(["VERCEL_FRONTEND_ORIGIN", "FRONTEND_ORIGINS"]);
    expect(fields.hasAppOrigins).toBe(false);
  });
});
