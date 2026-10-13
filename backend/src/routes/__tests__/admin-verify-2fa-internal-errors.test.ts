import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signAdminToken } from "../../lib/jwt";
import { captureSubsystemException } from "../../lib/sentry";
import { createAdminSession } from "../../lib/admin-session";

/**
 * R142 (E-3) — POST /api/admin/login/verify-2fa catch-all error truth.
 *
 * The endpoint's entire body sat in one `try { … } catch { 401 }`: the
 * catch existed for jwt.verify rejections (expected noise), but it also
 * swallowed failures from the admin select, the lockout store and
 * createAdminSession — a Postgres blip mid-2FA answered "جلسة غير صالحة"
 * with zero log lines and zero Sentry events. The fix distinguishes the
 * two classes: JWT-shaped noise keeps the uniform 401; internal errors
 * are captured via captureSubsystemException("auth") and answered with
 * the honest 500 INTERNAL_ERROR envelope (fail-closed either way).
 *
 * Module mocks mirror admin-auth-lockout.test.ts (fixed admin row via a
 * THROWING db select here, no-op lockout/session/crypto/audit); lib/jwt
 * is REAL so the temp token round-trips the actual HS256 secret.
 */

const h = vi.hoisted(() => ({
  /** When true, every db select in this graph rejects (outage). */
  dbThrows: true,
  sessionCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      if (h.dbThrows) throw new Error("simulated postgres outage");
      return {
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      };
    },
    update: () => ({
      set: () => ({
        where: async () => ({}),
      }),
    }),
  },
  adminUsersTable: { id: "admin_users.id", username: "admin_users.username" },
}));

vi.mock("../../lib/sentry", () => ({
  captureSubsystemException: vi.fn(),
}));

vi.mock("../../lib/lockout", () => ({
  checkLockout: vi.fn(async () => ({ locked: false, lockedUntil: null, attemptCount: 0 })),
  recordFailedAttempt: vi.fn(async () => {}),
  resetAttempts: vi.fn(async () => {}),
}));

vi.mock("../../lib/admin-session", () => ({
  createAdminSession: vi.fn(async (args: Record<string, unknown>) => {
    h.sessionCalls.push(args);
    return { token: "mocked-admin-session-jwt" };
  }),
  isValidAdminSession: vi.fn(async () => true),
  revokeAdminSession: vi.fn(async () => {}),
  revokeAllAdminSessions: vi.fn(async () => {}),
}));

vi.mock("../../lib/crypto", () => ({
  DUMMY_PASSWORD_HASH: "$argon2id$mocked-dummy-hash",
  verifyPassword: vi.fn(async () => ({ valid: true, needsRehash: false, resetRequired: false })),
  hashPassword: vi.fn(async () => "rehashed-mock"),
}));

vi.mock("../../lib/audit", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

import { adminAuthRouter } from "../admin/auth";

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

async function postVerify2fa(
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/login/verify-2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

beforeEach(() => {
  h.dbThrows = true;
  h.sessionCalls.length = 0;
  vi.mocked(captureSubsystemException).mockClear();
  vi.mocked(createAdminSession).mockClear();
});

describe("E-3 — verify-2fa distinguishes internal errors from invalid credentials", () => {
  it("DB outage mid-2FA → 500 INTERNAL_ERROR + Sentry capture, never a session mint", async () => {
    const { logger } = await import("../../lib/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const tempToken = signAdminToken(
      { adminId: 1, role: "super_admin", isTemp: true },
      { expiresIn: "10m" },
    );

    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify2fa(url, { temp_token: tempToken, code: "123456" });

      expect(res.status).toBe(500); // NOT the old uniform 401
      expect(res.body?.code).toBe("INTERNAL_ERROR");
      // Observable: captured under the auth subsystem with the route tag.
      expect(captureSubsystemException).toHaveBeenCalledTimes(1);
      const [subsystem, err, tags] = vi.mocked(captureSubsystemException).mock.calls[0]!;
      expect(subsystem).toBe("auth");
      expect((err as Error).message).toContain("simulated postgres outage");
      expect(tags).toMatchObject({ route: "login/verify-2fa" });
      // Fail-closed: no admin session was minted during the outage.
      expect(createAdminSession).not.toHaveBeenCalled();
      expect(h.sessionCalls).toHaveLength(0);
      expect(
        warnSpy.mock.calls.some((c) => c[1] === "[admin-auth] verify-2fa internal error"),
      ).toBe(true);
    } finally {
      close();
    }
  });

  it("invalid temp token (jwt.verify noise) → uniform 401, no capture, no 500", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerify2fa(url, { temp_token: "not-a-jwt", code: "123456" });

      expect(res.status).toBe(401);
      expect(res.body?.code).toBe("UNAUTHORIZED");
      expect(captureSubsystemException).not.toHaveBeenCalled();
      expect(createAdminSession).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
});
