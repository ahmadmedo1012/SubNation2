import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signAdminToken } from "../../lib/jwt";

/**
 * R97-01 (round-97 F2) — admin login lockout key derivation.
 *
 * The lockout key used to read the CF-Connecting-IP header RAW:
 *
 *   const clientIp =
 *     (typeof req.headers["cf-connecting-ip"] === "string" && req.headers["cf-connecting-ip"]) ||
 *     req.ip || "unknown";
 *
 * bypassing the H11 validation in cloudflareClientIp (which honours the
 * header ONLY when the rightmost XFF peer is a Cloudflare edge and then
 * rewrites req.ip). A direct connection to the always-reachable
 * subnation2.onrender.com origin could forge a fresh CF-Connecting-IP
 * per request, minting a NEW lockout key every time — the
 * 5-attempts/15-min lockout never engaged.
 *
 * These tests pin the fix:
 *   1. direct connection + FORGED CF-Connecting-IP (value varies per
 *      request) does NOT change the lockout key — the key is
 *      `admin:${username}:${req.ip}` with req.ip fixed;
 *   2. the key TRACKS req.ip when the cloudflareClientIp middleware
 *      legitimately rewrites it (real Cloudflare client → keyed by the
 *      real client IP);
 *   3. admin_sessions.ipAddress stores the same corrected value (the
 *      raw-header read also polluted session forensics);
 *   4. R97-02: the login / verify-2fa response bodies carry NO `token`
 *      — the httpOnly cookie is the sole session transport.
 *
 * Module mocks: @workspace/db (fixed admin row), lib/lockout (key
 * capture), lib/admin-session (arg capture), lib/crypto (password
 * verdict), lib/audit (no-op), otplib (TOTP verdict). lib/jwt is REAL
 * so the verify-2fa temp token round-trips the actual HS256 secret.
 */

const h = vi.hoisted(() => {
  const adminRow = {
    id: 1,
    username: "root",
    passwordHash: "$argon2id$mocked-not-a-real-hash",
    displayName: "Root Admin",
    role: "super_admin",
    permissions: ["all"],
    isActive: true,
    totpEnabled: false,
    totpSecret: null as string | null,
  };
  return {
    adminRow,
    lockoutKeys: { check: [] as string[], record: [] as string[], reset: [] as string[] },
    locked: false,
    sessionCalls: [] as Array<Record<string, unknown>>,
  };
});

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
  // Shape only — the real drizzle eq() wraps these into SQL the mocked
  // select chain never inspects.
  adminUsersTable: { id: "admin_users.id", username: "admin_users.username" },
}));

vi.mock("../../lib/lockout", () => ({
  checkLockout: vi.fn(async (key: string) => {
    h.lockoutKeys.check.push(key);
    return {
      locked: h.locked,
      lockedUntil: h.locked ? new Date(Date.now() + 10 * 60_000) : null,
    };
  }),
  recordFailedAttempt: vi.fn(async (key: string) => {
    h.lockoutKeys.record.push(key);
  }),
  resetAttempts: vi.fn(async (key: string) => {
    h.lockoutKeys.reset.push(key);
  }),
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
  verifyPassword: vi.fn(async () => ({ valid: true, needsRehash: false })),
  hashPassword: vi.fn(async () => "rehashed-mock"),
}));

vi.mock("../../lib/audit", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

vi.mock("otplib", () => ({
  generateSecret: () => "MOCKTOTPSECRET",
  generateURI: () => "otpauth://totp/mock",
  verifySync: () => true,
}));

import { adminAuthRouter } from "../admin/auth";

// ── Mini-app harness (same shape as body-schema-400s.test.ts) ────────────────

/** req.ip as the express app saw it, one entry per request. */
const seenIps: string[] = [];

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    seenIps.push(String(req.ip));
    next();
  });
  app.use("/api/admin", adminAuthRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

interface LoginResponse {
  status: number;
  body: Record<string, unknown> | null;
  cookies: string[];
}

async function postLogin(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<LoginResponse> {
  const res = await fetch(`${url}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    cookies: res.headers.getSetCookie(),
  };
}

beforeEach(() => {
  h.lockoutKeys.check.length = 0;
  h.lockoutKeys.record.length = 0;
  h.lockoutKeys.reset.length = 0;
  h.sessionCalls.length = 0;
  h.locked = false;
  seenIps.length = 0;
  h.adminRow.totpEnabled = false;
  h.adminRow.totpSecret = null;
});

// ── R97-01: the lockout key is unforgeable via CF-Connecting-IP ──────────────

describe("R97-01 — admin login lockout keys on req.ip, not the raw CF header", () => {
  it("a forged CF-Connecting-IP does NOT change the lockout key (direct connection)", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      // Three attempts from the SAME direct connection (127.0.0.1), each
      // with a DIFFERENT forged CF-Connecting-IP — the exact R97-01
      // attack: rotate the header, mint a fresh lockout key every time.
      const forged = ["1.2.3.4", "5.6.7.8", "2001:db8::1"];
      for (const ip of forged) {
        const res = await postLogin(
          url,
          { username: "root", password: "guess" },
          {
            "CF-Connecting-IP": ip,
          },
        );
        expect(res.status).toBe(200);
      }

      expect(h.lockoutKeys.check).toHaveLength(3);
      // Same key for all three — the lockout envelope accumulates.
      expect(new Set(h.lockoutKeys.check).size).toBe(1);
      const key = h.lockoutKeys.check[0]!;
      // The key is username + the connection's req.ip …
      expect(key).toBe(`admin:root:${seenIps[0]}`);
      // … and contains NONE of the forged header values.
      for (const ip of forged) {
        expect(key).not.toContain(ip);
      }
    } finally {
      close();
    }
  });

  it("a missing CF-Connecting-IP header yields the same key (no header games)", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      await postLogin(url, { username: "root", password: "guess" });
      await postLogin(
        url,
        { username: "root", password: "guess" },
        {
          "CF-Connecting-IP": "9.9.9.9",
        },
      );
      await postLogin(url, { username: "root", password: "guess" });

      expect(new Set(h.lockoutKeys.check).size).toBe(1);
      expect(h.lockoutKeys.check[0]).toBe(`admin:root:${seenIps[0]}`);
    } finally {
      close();
    }
  });

  it("the key TRACKS req.ip when cloudflareClientIp legitimately rewrites it", async () => {
    // Mirror of what the real middleware does behind Cloudflare: the
    // rightmost XFF peer is a CF edge → req.ip is overwritten with the
    // CF-Connecting-IP value. The lockout must key on the CORRECTED
    // value (real Cloudflare clients accumulate into one envelope).
    const app = express();
    app.use(express.json());
    const seen: string[] = [];
    app.use((req, _res, next) => {
      // Same mechanism cloudflareClientIp.ts uses (Object.defineProperty
      // on the read-only getter).
      Object.defineProperty(req, "ip", {
        value: "203.0.113.9",
        configurable: true,
        writable: true,
      });
      seen.push(String(req.ip));
      next();
    });
    app.use("/api/admin", adminAuthRouter);
    const { url, close } = await listen(app);
    try {
      await postLogin(
        url,
        { username: "root", password: "guess" },
        {
          "CF-Connecting-IP": "203.0.113.9",
          "X-Forwarded-For": "198.51.100.7, 172.71.10.9",
        },
      );
      await postLogin(
        url,
        { username: "root", password: "guess" },
        {
          "CF-Connecting-IP": "203.0.113.9",
          "X-Forwarded-For": "198.51.100.8, 172.71.10.9",
        },
      );

      expect(new Set(h.lockoutKeys.check).size).toBe(1);
      expect(h.lockoutKeys.check[0]).toBe("admin:root:203.0.113.9");
    } finally {
      close();
    }
  });

  it("admin_sessions.ipAddress records the corrected IP, never the forged header (R97-01 side-effect)", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const res = await postLogin(
        url,
        { username: "root", password: "right" },
        {
          "CF-Connecting-IP": "6.6.6.6",
        },
      );
      expect(res.status).toBe(200);

      expect(h.sessionCalls).toHaveLength(1);
      const session = h.sessionCalls[0]!;
      expect(session.ipAddress).toBe(seenIps[0]);
      expect(session.ipAddress).not.toBe("6.6.6.6");
    } finally {
      close();
    }
  });

  it("an engaged lockout still 429s before any password verification", async () => {
    h.locked = true;
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const res = await postLogin(url, { username: "root", password: "guess" });
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ code: "ACCOUNT_LOCKED" });
    } finally {
      close();
    }
  });
});

// ── R97-02: the session JWT leaves only via the httpOnly cookie ──────────────

describe("R97-02 — admin login responses carry no session token in the body", () => {
  it("/login returns profile fields only; the session rides the httpOnly cookie", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const res = await postLogin(url, { username: "root", password: "right" });
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("token");
      expect(res.body).toMatchObject({
        display_name: "Root Admin",
        role: "super_admin",
        permissions: ["all"],
      });
      // The httpOnly cookie is the sole transport.
      const cookie = res.cookies.find((c) => c.startsWith("admin_token="));
      expect(cookie).toBeDefined();
      expect(cookie).toContain("HttpOnly");
    } finally {
      close();
    }
  });

  it("/login/verify-2fa returns profile fields only; cookie set; ipAddress from req.ip", async () => {
    h.adminRow.totpEnabled = true;
    h.adminRow.totpSecret = "TOTPSECRET";

    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      // The 10-minute challenge token from the /login response IS still
      // returned (it is a challenge credential, not a session).
      const first = await postLogin(url, { username: "root", password: "right" });
      expect(first.status).toBe(200);
      const firstBody = first.body!;
      expect(firstBody).toMatchObject({ requires_2fa: true });
      expect(typeof firstBody.temp_token).toBe("string");

      const res = await fetch(`${url}/api/admin/login/verify-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          temp_token: firstBody.temp_token as string,
          code: "123456",
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body).not.toHaveProperty("token");
      expect(body).toMatchObject({ display_name: "Root Admin", role: "super_admin" });

      const cookie = res.headers.getSetCookie().find((c) => c.startsWith("admin_token="));
      expect(cookie).toBeDefined();
      expect(cookie).toContain("HttpOnly");

      // verify-2fa stores req.ip (already the corrected value).
      expect(h.sessionCalls).toHaveLength(1);
      expect(h.sessionCalls[0]!.ipAddress).toBe(seenIps[1]);
    } finally {
      close();
    }
  });

  it("a tampered temp token is rejected 401 without minting a session", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      const legit = signAdminToken({ adminId: 1, role: "super_admin", isTemp: true });
      const tampered = `${legit.slice(0, -3)}${legit.endsWith("AAA") ? "BBB" : "AAA"}`;
      const res = await fetch(`${url}/api/admin/login/verify-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp_token: tampered, code: "123456" }),
      });
      expect(res.status).toBe(401);
      expect(h.sessionCalls).toHaveLength(0);
    } finally {
      close();
    }
  });
});
