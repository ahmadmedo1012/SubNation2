import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSecret, generateSync } from "otplib";
import { signAdminToken } from "../../../lib/jwt";
import { captureSubsystemException } from "../../../lib/sentry";
import { createAdminSession } from "../../../lib/admin-session";
import { recordFailedAttempt } from "../../../lib/lockout";

/**
 * E-F1 (R186) — malformed TOTP codes must answer the house 400, never 500.
 *
 * otplib v13's verifySync THROWS on malformed token shapes ("12345" →
 * "Token must be 6 digits, got 5"; "abc"; non-strings). Both 2FA entry
 * guards only checked truthiness, so a client typo reached verifySync:
 * /login/verify-2fa laundered the throw through its internal-error catch
 * into a 500 INTERNAL_ERROR + Sentry event, and /2fa/verify-setup (no
 * try/catch) escaped to the global error handler — while the shared
 * per-admin lockout counter (`admin-2fa:{id}`, fed only by well-formed
 * wrong codes) never moved.
 *
 * Locked behaviours (the E-F1 shape gate at both entries):
 *   - code "12345" → 400 INVALID_DATA on BOTH endpoints, with zero
 *     Sentry captures, zero lockout ticks, zero sessions minted;
 *   - a well-formed WRONG code keeps the pre-fix path byte-identical:
 *     401 UNAUTHORIZED + recordFailedAttempt("admin-2fa:{id}").
 *
 * Module mocks mirror admin-auth-lockout.test.ts (fixed admin row, no-op
 * lockout with arg capture, no-op session/crypto/audit); otplib is
 * deliberately NOT mocked — the real verifySync is the throwing surface
 * this file pins — and lib/jwt is REAL so both tokens round-trip the
 * actual HS256 secret.
 */

const h = vi.hoisted(() => ({
  /** Fixed admin row — plaintext base32 secret (safeDecrypt's legacy
   * passthrough keeps it verifiable) + totpEnabled, so both endpoints
   * reach the real verifySync call. */
  adminRow: {
    id: 1,
    username: "root",
    passwordHash: "$argon2id$mocked-not-a-real-hash",
    displayName: "Root Admin",
    role: "super_admin",
    permissions: ["all"],
    isActive: true,
    totpEnabled: true,
    totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  },
  /** recordFailedAttempt keys in call order — the lockout-path pin. */
  recordCalls: [] as string[],
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [h.adminRow],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => ({}),
      }),
    }),
  },
  // Shape only — requireAdmin's column select touches these keys; the
  // mocked chain never builds SQL from them (admin-auth-lockout idiom).
  adminUsersTable: {
    id: "admin_users.id",
    username: "admin_users.username",
    role: "admin_users.role",
    isActive: "admin_users.isActive",
    permissions: "admin_users.permissions",
  },
}));

vi.mock("../../../lib/sentry", () => ({
  captureSubsystemException: vi.fn(),
}));

vi.mock("../../../lib/lockout", () => ({
  checkLockout: vi.fn(async () => ({ locked: false, lockedUntil: null, attemptCount: 0 })),
  recordFailedAttempt: vi.fn(async (key: string) => {
    h.recordCalls.push(key);
  }),
  resetAttempts: vi.fn(async () => {}),
}));

vi.mock("../../../lib/admin-session", () => ({
  createAdminSession: vi.fn(async () => ({ token: "mocked-admin-session-jwt" })),
  isValidAdminSession: vi.fn(async () => true),
  revokeAdminSession: vi.fn(async () => {}),
  revokeAllAdminSessions: vi.fn(async () => {}),
}));

vi.mock("../../../lib/crypto", () => ({
  DUMMY_PASSWORD_HASH: "$argon2id$mocked-dummy-hash",
  verifyPassword: vi.fn(async () => ({ valid: true, needsRehash: false, resetRequired: false })),
  hashPassword: vi.fn(async () => "rehashed-mock"),
}));

vi.mock("../../../lib/audit", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

import { adminAuthRouter } from "../auth";

// ── Mini-app harness (same shape as admin-verify-2fa-internal-errors.test.ts) ──

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminAuthRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

interface JsonRes {
  status: number;
  body: Record<string, unknown> | null;
}

async function postJson(
  url: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<JsonRes> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** A code minted from a DIFFERENT secret — deterministically wrong for the
 * admin's fixed row secret (the 2fa-verify-setup-lockout wrongCode idiom). */
function wrongCode(): string {
  return generateSync({ secret: generateSecret() });
}

beforeEach(() => {
  h.recordCalls.length = 0;
  vi.mocked(captureSubsystemException).mockClear();
  vi.mocked(recordFailedAttempt).mockClear();
  vi.mocked(createAdminSession).mockClear();
});

describe("E-F1 (R186) — POST /api/admin/login/verify-2fa malformed-code shape gate", () => {
  it('code "12345" → the house 400 INVALID_DATA, NOT the otplib throw → 500: no Sentry, no lockout tick, no session', async () => {
    // Real HS256 temp token (lib/jwt unmocked) — the challenge is valid;
    // only the code's shape is wrong.
    const tempToken = signAdminToken(
      { adminId: 1, role: "super_admin", isTemp: true },
      { expiresIn: "10m" },
    );
    const { url, close } = await listen(buildApp());
    try {
      const res = await postJson(url, "/api/admin/login/verify-2fa", {
        temp_token: tempToken,
        code: "12345",
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      // The pre-fix path laundered otplib's throw into the internal-error
      // catch: a 500 + exactly one Sentry capture. Neither may happen now.
      expect(captureSubsystemException).not.toHaveBeenCalled();
      // A malformed shape is not a guess at the code — no lockout tick.
      expect(recordFailedAttempt).not.toHaveBeenCalled();
      // Fail-closed: no admin session was minted.
      expect(createAdminSession).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("a well-formed WRONG code keeps the byte-identical 401 + recordFailedAttempt(admin-2fa:{id}) path", async () => {
    const tempToken = signAdminToken(
      { adminId: 1, role: "super_admin", isTemp: true },
      { expiresIn: "10m" },
    );
    const { url, close } = await listen(buildApp());
    try {
      const res = await postJson(url, "/api/admin/login/verify-2fa", {
        temp_token: tempToken,
        code: wrongCode(),
      });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "UNAUTHORIZED" });
      expect(recordFailedAttempt).toHaveBeenCalledTimes(1);
      expect(h.recordCalls).toEqual(["admin-2fa:1"]);
      expect(createAdminSession).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
});

describe("E-F1 (R186) — POST /api/admin/2fa/verify-setup malformed-code shape gate", () => {
  it('code "12345" → 400 INVALID_DATA — the handler has no try/catch, so the pre-fix throw escaped to the global 500; no lockout tick', async () => {
    const token = signAdminToken({ adminId: 1, role: "super_admin" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postJson(url, "/api/admin/2fa/verify-setup", { code: "12345" }, token);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(recordFailedAttempt).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("a well-formed WRONG code keeps the 401 + recordFailedAttempt(admin-2fa:{id}) path (same shared budget as verify-2fa)", async () => {
    const token = signAdminToken({ adminId: 1, role: "super_admin" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postJson(url, "/api/admin/2fa/verify-setup", { code: wrongCode() }, token);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "UNAUTHORIZED" });
      expect(recordFailedAttempt).toHaveBeenCalledTimes(1);
      expect(h.recordCalls).toEqual(["admin-2fa:1"]);
    } finally {
      close();
    }
  });
});
