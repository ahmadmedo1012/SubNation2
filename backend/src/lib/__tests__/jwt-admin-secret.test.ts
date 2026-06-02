/**
 * Admin secret separation — F-001 regression coverage.
 *
 * Asserts the admin JWT signing key is independent of the customer
 * signing key (Constitution Principle II + security audit 004 / F-001).
 *
 * Each scenario re-imports `lib/jwt.ts` from scratch via vi.resetModules()
 * because the module reads env at load time and exports the resolved
 * secrets as constants. Without resetModules, only the first scenario's
 * env state would be honored.
 *
 * Spec authority: closes Finding F-001 (specs/004-security-audit/security.md
 * §3) — admin token signing key derived from customer secret by string
 * concatenation. A leak of SESSION_SECRET instantly produced the admin
 * key with no extra step.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STRONG_SESSION = "test-session-secret-32-chars-strong-and-distinct";
const STRONG_ADMIN = "test-admin-secret-32-chars-strong-and-also-distinct";

const ENV_KEYS = ["NODE_ENV", "SESSION_SECRET", "ADMIN_JWT_SECRET"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const previousEnv: Partial<Record<EnvKey, string | undefined>> = {};

function setEnv(values: Partial<Record<EnvKey, string | undefined>>) {
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key as EnvKey];
    } else {
      process.env[key as EnvKey] = value;
    }
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousEnv[key];
    }
  }
}

describe("F-001 — admin secret separation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("uses ADMIN_JWT_SECRET when set, separate from SESSION_SECRET", async () => {
    setEnv({
      NODE_ENV: "production",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: STRONG_ADMIN,
    });

    const jwtModule = await import("../jwt");
    expect(jwtModule.JWT_SECRET).toBe(STRONG_SESSION);
    expect(jwtModule.ADMIN_JWT_SECRET).toBe(STRONG_ADMIN);
    expect(jwtModule.ADMIN_JWT_SECRET).not.toBe(jwtModule.JWT_SECRET);
  });

  it("admin tokens signed with ADMIN_JWT_SECRET cannot be verified with SESSION_SECRET", async () => {
    setEnv({
      NODE_ENV: "production",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: STRONG_ADMIN,
    });

    const { signAdminToken, verifyUserToken } = await import("../jwt");
    const adminToken = signAdminToken({ adminId: 42, role: "owner" });

    // verifyUserToken uses JWT_SECRET (the customer secret). It must NOT
    // accept a token signed with the admin secret — that's the whole
    // point of separation.
    expect(verifyUserToken(adminToken)).toBeNull();
  });

  it("rejects ADMIN_JWT_SECRET that is shorter than 32 chars", async () => {
    setEnv({
      NODE_ENV: "production",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: "too-short",
    });

    await expect(import("../jwt")).rejects.toThrow(/at least 32 characters/);
  });

  it("rejects ADMIN_JWT_SECRET that equals SESSION_SECRET", async () => {
    setEnv({
      NODE_ENV: "production",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: STRONG_SESSION,
    });

    await expect(import("../jwt")).rejects.toThrow(/must NOT equal SESSION_SECRET/);
  });

  it("fails fast in production when ADMIN_JWT_SECRET is missing", async () => {
    setEnv({
      NODE_ENV: "production",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: undefined,
    });

    await expect(import("../jwt")).rejects.toThrow(
      /ADMIN_JWT_SECRET environment variable is required/,
    );
  });

  it("falls back to derivation in non-production with a deprecation warning", async () => {
    setEnv({
      NODE_ENV: "development",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: undefined,
    });

    // The fallback path should not throw — dev environments without the
    // new env var keep working until operators add it.
    const jwtModule = await import("../jwt");
    expect(jwtModule.JWT_SECRET).toBe(STRONG_SESSION);
    // Documented transitional behavior: derived value, NOT equal to JWT_SECRET.
    expect(jwtModule.ADMIN_JWT_SECRET).toBe(STRONG_SESSION + "_admin");
    expect(jwtModule.ADMIN_JWT_SECRET).not.toBe(jwtModule.JWT_SECRET);
  });

  it("test environment behaves like development for the fallback path", async () => {
    setEnv({
      NODE_ENV: "test",
      SESSION_SECRET: STRONG_SESSION,
      ADMIN_JWT_SECRET: undefined,
    });

    const jwtModule = await import("../jwt");
    expect(jwtModule.ADMIN_JWT_SECRET).toBe(STRONG_SESSION + "_admin");
  });
});
