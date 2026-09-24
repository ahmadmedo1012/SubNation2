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
 * R110-01 (round-110, R109 109-g §8 P2): POST /login additionally
 * consults a GLOBAL, IP-independent `admin-username:${username}` lockout
 * (threshold 10 / base 15 min — see USERNAME_LOCKOUT_POLICY in
 * routes/admin/auth.ts) so a distributed attacker rotating source IPs
 * hits a per-username ceiling. The locked branch MUST be a uniform 401
 * (dummy argon2 included) — the R110 describe block pins the ceiling,
 * its expiry/decay, the below-threshold success path, and the absence of
 * any enumeration/timing split vs the unknown-username and
 * wrong-password branches.
 *
 * Module mocks: @workspace/db (fixed admin row + h.dbReturnsAdmin toggle
 * for the unknown-username branch), lib/lockout (key capture + an
 * in-memory mirror of the login_attempts envelope), lib/admin-session
 * (arg capture), lib/crypto (verdict via h.verify + a mocked dummy-hash
 * constant), lib/audit (no-op), otplib (TOTP verdict). lib/jwt is REAL
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
    // ── R110-01: in-memory mirror of lib/lockout's login_attempts row ──
    /** identifier → attempt_count (drives the mock's lockout threshold). */
    failureCounts: new Map<string, number>(),
    /** identifier → lockedUntil (ms epoch); a future value = locked. */
    lockedUntilByKey: new Map<string, number>(),
    /** The mocked verifyPassword verdict — selects which login branch runs. */
    verify: { valid: true, needsRehash: false, resetRequired: false } as {
      valid: boolean;
      needsRehash: boolean;
      resetRequired: boolean;
    },
    /** When false, the mocked db select returns [] (unknown-username branch). */
    dbReturnsAdmin: true,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // R110: h.dbReturnsAdmin=false feeds the unknown-username branch.
          limit: async () => (h.dbReturnsAdmin ? [h.adminRow] : []),
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
    // h.locked = legacy kill-switch: every key reports locked (the
    // per-IP 429 contract). Otherwise mirror the real helper: a future
    // locked_until locks; an EXPIRED one decays the envelope to zero
    // (the keep-the-row bookkeeping is DB-internal, invisible here).
    if (h.locked) {
      return { locked: true, lockedUntil: new Date(Date.now() + 10 * 60_000), attemptCount: 0 };
    }
    const until = h.lockedUntilByKey.get(key);
    if (until === undefined) {
      return { locked: false, lockedUntil: null, attemptCount: 0 };
    }
    if (until > Date.now()) {
      return { locked: true, lockedUntil: new Date(until), attemptCount: 0 };
    }
    h.lockedUntilByKey.delete(key);
    h.failureCounts.delete(key);
    return { locked: false, lockedUntil: null, attemptCount: 0 };
  }),
  recordFailedAttempt: vi.fn(async (key: string, policy?: { maxAttempts?: number }) => {
    h.lockoutKeys.record.push(key);
    // Mirror of the real upsert's SQL CASE: count+1 >= the namespace's
    // maxAttempts flips locked_until on at the base 15-min duration
    // (the exponential tiers are DB-internal and pinned by
    // lockout-upsert.test.ts — not observable from the route).
    const maxAttempts = policy?.maxAttempts ?? 5;
    const next = (h.failureCounts.get(key) ?? 0) + 1;
    h.failureCounts.set(key, next);
    if (next >= maxAttempts) {
      h.lockedUntilByKey.set(key, Date.now() + 15 * 60_000);
    }
  }),
  resetAttempts: vi.fn(async (key: string) => {
    h.lockoutKeys.reset.push(key);
    h.failureCounts.delete(key);
    h.lockedUntilByKey.delete(key);
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
  // 98-F3 shape: the dummy-hash constant the route pairs with the dummy
  // verify on the parity branches (real precomputed value lives in
  // lib/crypto.ts — its ARGON2 cost is what the mock can't reproduce).
  DUMMY_PASSWORD_HASH: "$argon2id$mocked-dummy-hash",
  verifyPassword: vi.fn(async () => h.verify),
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
import { verifyPassword } from "../../lib/crypto"; // the mocked one — call-arg capture

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

/**
 * R110-01 harness: per-request req.ip override driven by the test-only
 * `x-test-client-ip` header — the same Object.defineProperty mechanism
 * the CF-tracking test below uses to mirror cloudflareClientIp's
 * rewrite. Lets one test simulate a distributed attacker (every request
 * from a different source IP) against a single real HTTP listener.
 */
function buildMultiIpApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.headers["x-test-client-ip"];
    const ip = typeof header === "string" && header ? header : String(req.ip);
    seenIps.push(ip);
    if (ip !== String(req.ip)) {
      Object.defineProperty(req, "ip", { value: ip, configurable: true, writable: true });
    }
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
  // R110-01 state: fresh envelope mirror, default success verdict, admin
  // row visible, and a clean argon2 call log.
  h.failureCounts.clear();
  h.lockedUntilByKey.clear();
  h.verify = { valid: true, needsRehash: false, resetRequired: false };
  h.dbReturnsAdmin = true;
  vi.mocked(verifyPassword).mockClear();
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

      expect(h.lockoutKeys.check).toHaveLength(6); // 3 requests × 2 keys (R110-01)
      // Same per-IP key for all three — the lockout envelope accumulates.
      // (R110-01: every login also consults the global `admin-username:`
      // key, so filter down to the IP-keyed surface under attack here.)
      const ipKeys = h.lockoutKeys.check.filter((k) => k.startsWith("admin:root:"));
      expect(ipKeys).toHaveLength(3);
      expect(new Set(ipKeys).size).toBe(1);
      const key = ipKeys[0]!;
      // The key is username + the connection's req.ip …
      expect(key).toBe(`admin:root:${seenIps[0]}`);
      // … and contains NONE of the forged header values.
      for (const ip of forged) {
        expect(key).not.toContain(ip);
      }
      // R110-01: the IP-independent username key is constant (no header
      // or IP component to forge) and was consulted on every request.
      const usernameKeys = h.lockoutKeys.check.filter((k) => k.startsWith("admin-username:"));
      expect(usernameKeys).toEqual([
        "admin-username:root",
        "admin-username:root",
        "admin-username:root",
      ]);
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

      const ipKeys = h.lockoutKeys.check.filter((k) => k.startsWith("admin:root:"));
      expect(new Set(ipKeys).size).toBe(1);
      expect(ipKeys[0]).toBe(`admin:root:${seenIps[0]}`);
      expect(h.lockoutKeys.check.filter((k) => k.startsWith("admin-username:"))).toEqual([
        "admin-username:root",
        "admin-username:root",
        "admin-username:root",
      ]);
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

      const ipKeys = h.lockoutKeys.check.filter((k) => k.startsWith("admin:root:"));
      expect(new Set(ipKeys).size).toBe(1);
      expect(ipKeys[0]).toBe("admin:root:203.0.113.9");
      expect(h.lockoutKeys.check.filter((k) => k.startsWith("admin-username:"))).toEqual([
        "admin-username:root",
        "admin-username:root",
      ]);
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

// ── R110-01: global per-username password ceiling (distributed brute force) ──

describe("R110-01 — global per-username lockout on the password step", () => {
  /** The byte-exact invalid-credentials envelope every failure branch shares. */
  const UNIFORM_401 = { error: "اسم المستخدم أو كلمة المرور غير صحيحة", code: "UNAUTHORIZED" };
  const DUMMY_HASH = "$argon2id$mocked-dummy-hash"; // the mocked DUMMY_PASSWORD_HASH
  const REAL_HASH = "$argon2id$mocked-not-a-real-hash"; // h.adminRow.passwordHash
  const INVALID = () => ({ valid: false, needsRehash: false, resetRequired: false });
  const VALID = () => ({ valid: true, needsRehash: false, resetRequired: false });

  it("(a) 10 wrong passwords at ONE username from 10 DIFFERENT IPs lock it globally — the 11th, correct attempt is a uniform 401", async () => {
    h.verify = INVALID();
    const app = buildMultiIpApp();
    const { url, close } = await listen(app);
    try {
      // Distributed attack shape: every request from a FRESH source IP —
      // the per-(username,ip) envelope sees count 1 each time and never
      // engages; only the global per-username key accumulates.
      for (let i = 1; i <= 10; i++) {
        const res = await postLogin(
          url,
          { username: "root", password: "wrong" },
          { "x-test-client-ip": `198.51.100.${i}` },
        );
        expect(res.status).toBe(401);
        expect(res.body).toEqual(UNIFORM_401);
      }

      // 11th attempt: yet another fresh IP, this time the CORRECT
      // password — still rejected, byte-identical to the 10 failures
      // above (a locked username is indistinguishable from an
      // invalid-credentials one).
      const eleventh = await postLogin(
        url,
        { username: "root", password: "right" },
        { "x-test-client-ip": "198.51.100.11" },
      );
      expect(eleventh.status).toBe(401);
      expect(eleventh.body).toEqual(UNIFORM_401);

      // No session was ever minted; the global envelope was never reset.
      expect(h.sessionCalls).toHaveLength(0);
      expect(h.lockoutKeys.reset).not.toContain("admin-username:root");

      // The per-(username,ip) envelopes never engaged: 11 distinct IP
      // keys, each carrying a single failure (threshold 5 never reached).
      const ipKeys = h.lockoutKeys.check.filter((k) => k.startsWith("admin:root:"));
      expect(new Set(ipKeys).size).toBe(11);
      expect(h.lockoutKeys.record.filter((k) => k.startsWith("admin:root:"))).toHaveLength(10);

      // The username key accrued exactly the 10 failures (the 11th,
      // locked request records nothing)…
      expect(h.lockoutKeys.record.filter((k) => k === "admin-username:root")).toHaveLength(10);

      // …and every request paid exactly ONE argon2: requests 1–10 against
      // the real hash, the locked 11th against the DUMMY hash (98-F3
      // parity — no cheap fast-401 oracle on the locked branch).
      const calls = vi.mocked(verifyPassword).mock.calls;
      expect(calls).toHaveLength(11);
      expect(calls.slice(0, 10).every(([, hash]) => hash === REAL_HASH)).toBe(true);
      expect(calls[10]).toEqual(["right", DUMMY_HASH]);
    } finally {
      close();
    }
  });

  it("(b)+(e) 9 failures across 9 IPs stay BELOW the ceiling — the 10th, correct attempt from a fresh IP succeeds", async () => {
    h.verify = INVALID();
    const app = buildMultiIpApp();
    const { url, close } = await listen(app);
    try {
      for (let i = 1; i <= 9; i++) {
        const res = await postLogin(
          url,
          { username: "root", password: "wrong" },
          { "x-test-client-ip": `203.0.113.${i}` },
        );
        expect(res.status).toBe(401);
        expect(res.body).toEqual(UNIFORM_401);
      }

      // Below the threshold the ceiling is invisible: correct password
      // logs in, cookie minted, session row created…
      h.verify = VALID();
      const res = await postLogin(
        url,
        { username: "root", password: "right" },
        { "x-test-client-ip": "203.0.113.99" },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ display_name: "Root Admin", role: "super_admin" });
      expect(res.cookies.find((c) => c.startsWith("admin_token="))).toBeDefined();

      // …and BOTH envelopes were cleared on success.
      expect(h.sessionCalls).toHaveLength(1);
      expect(h.lockoutKeys.reset).toContain("admin-username:root");
      expect(h.lockoutKeys.reset).toContain("admin:root:203.0.113.99");
    } finally {
      close();
    }
  });

  it("(e) a legit admin fat-fingering twice from the SAME IP still logs in", async () => {
    const app = buildMultiIpApp();
    const { url, close } = await listen(app);
    try {
      h.verify = INVALID();
      for (let i = 0; i < 2; i++) {
        const res = await postLogin(
          url,
          { username: "root", password: "wrong" },
          { "x-test-client-ip": "192.0.2.10" },
        );
        expect(res.status).toBe(401);
      }
      h.verify = VALID();
      const res = await postLogin(
        url,
        { username: "root", password: "right" },
        { "x-test-client-ip": "192.0.2.10" },
      );
      expect(res.status).toBe(200);
      expect(h.sessionCalls).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("(c) an engaged global lock EXPIRES and the envelope DECAYS to zero", async () => {
    const app = buildMultiIpApp();
    const { url, close } = await listen(app);
    try {
      // Engage the lock for real: 10 wrong passwords, one per IP.
      h.verify = INVALID();
      for (let i = 1; i <= 10; i++) {
        const res = await postLogin(
          url,
          { username: "root", password: "wrong" },
          { "x-test-client-ip": `198.51.100.${i}` },
        );
        expect(res.status).toBe(401);
      }

      // Engaged: even the CORRECT password from a fresh IP → uniform 401.
      h.verify = VALID();
      const locked = await postLogin(
        url,
        { username: "root", password: "right" },
        { "x-test-client-ip": "198.51.100.50" },
      );
      expect(locked.status).toBe(401);
      expect(locked.body).toEqual(UNIFORM_401);

      // Let the 15-minute window lapse (forced past-expiry — the same
      // trick lockout-upsert.test.ts plays against the real table).
      const until = h.lockedUntilByKey.get("admin-username:root");
      expect(until).toBeDefined();
      h.lockedUntilByKey.set("admin-username:root", Date.now() - 1_000);

      // DECAY: the expired envelope restarts at zero. These 9 fresh
      // failures do NOT re-engage it — were the pre-expiry count of 10
      // preserved, the very first of them would re-lock for 15 min and
      // the attempt below would 401.
      h.verify = INVALID();
      for (let i = 1; i <= 9; i++) {
        const res = await postLogin(
          url,
          { username: "root", password: "wrong" },
          { "x-test-client-ip": `203.0.113.${i}` },
        );
        expect(res.status).toBe(401);
        expect(res.body).toEqual(UNIFORM_401);
      }
      h.verify = VALID();
      const retry = await postLogin(
        url,
        { username: "root", password: "right" },
        { "x-test-client-ip": "203.0.113.99" },
      );
      expect(retry.status).toBe(200);
      expect(h.sessionCalls).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("(d) locked / unknown-username / wrong-password are byte-identical 401s — no enumeration, no timing split", async () => {
    const app = buildMultiIpApp();
    const { url, close } = await listen(app);
    try {
      // (1) Globally LOCKED username — even the correct password fails.
      h.lockedUntilByKey.set("admin-username:root", Date.now() + 15 * 60_000);
      h.verify = VALID();
      vi.mocked(verifyPassword).mockClear();
      const lockedRes = await postLogin(
        url,
        { username: "root", password: "right" },
        { "x-test-client-ip": "192.0.2.1" },
      );
      expect(lockedRes.status).toBe(401);
      const lockedCalls = [...vi.mocked(verifyPassword).mock.calls];

      // (2) UNKNOWN username (select comes back empty).
      h.lockedUntilByKey.clear();
      h.dbReturnsAdmin = false;
      vi.mocked(verifyPassword).mockClear();
      const unknownRes = await postLogin(
        url,
        { username: "ghost", password: "right" },
        { "x-test-client-ip": "192.0.2.2" },
      );
      expect(unknownRes.status).toBe(401);
      const unknownCalls = [...vi.mocked(verifyPassword).mock.calls];

      // (3) KNOWN username, WRONG password.
      h.dbReturnsAdmin = true;
      h.verify = INVALID();
      vi.mocked(verifyPassword).mockClear();
      const wrongRes = await postLogin(
        url,
        { username: "root", password: "wrong" },
        { "x-test-client-ip": "192.0.2.3" },
      );
      expect(wrongRes.status).toBe(401);
      const wrongCalls = [...vi.mocked(verifyPassword).mock.calls];

      // Identical bodies: locked looks exactly like unknown-username and
      // like wrong-password — no status/message/code split an attacker
      // could use to enumerate real usernames.
      expect(lockedRes.body).toEqual(UNIFORM_401);
      expect(unknownRes.body).toEqual(UNIFORM_401);
      expect(wrongRes.body).toEqual(UNIFORM_401);

      // Timing parity: each of the three paths paid exactly ONE argon2 —
      // locked + unknown against the DUMMY hash, wrong-password against
      // the real one (the ~1 ms DB work around it is noise under argon2's
      // ~100 ms).
      expect(lockedCalls).toEqual([["right", DUMMY_HASH]]);
      expect(unknownCalls).toEqual([["right", DUMMY_HASH]]);
      expect(wrongCalls).toEqual([["wrong", REAL_HASH]]);

      // The locked branch recorded NOTHING (192.0.2.1 never appears) —
      // the trio's only per-(user,ip) record is the wrong-password one.
      expect(h.lockoutKeys.record.filter((k) => k.startsWith("admin:root:"))).toEqual([
        "admin:root:192.0.2.3",
      ]);

      // No session, no reset anywhere in the trio.
      expect(h.sessionCalls).toHaveLength(0);
      expect(h.lockoutKeys.reset).toHaveLength(0);
    } finally {
      close();
    }
  });
});

// ── B2-F1 (R111, round-111 B2 audit): unbounded username vs varchar(100) ────
//
// AdminLoginBody (generated) has no username bound, and the lockout keys
// embed the SUBMITTED username — a 100+ char username overflowed
// login_attempts.identifier (22001) → 500 + Sentry event per failed
// attempt, breaking the uniform-401 parity. The durable fix is the clamp
// in lib/lockout.ts (pinned by lockout-upsert.test.ts); the route adds a
// 255-char OUTER perimeter so multi-KB junk never reaches the keys, while
// 101..255-char names still land on the honest uniform-401 not-found
// branch (no real admin username can exceed the varchar(100) column).

describe("B2-F1 — oversized usernames keep the uniform-401 parity (R111)", () => {
  it("a 200-char username → uniform 401, dummy-argon2 parity, lockout keys still recorded", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      // Unknown-username branch: no admin row can carry a 200-char name
      // (the column is varchar(100)).
      h.dbReturnsAdmin = false;
      vi.mocked(verifyPassword).mockClear();

      const res = await postLogin(url, {
        username: "z".repeat(200),
        password: "guess",
      });

      // THE FIX: 401 (uniform envelope), never a 500 from the overflowed
      // lockout identifier.
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "UNAUTHORIZED" });

      // 98-F3 parity: the not-found branch ran the SAME single dummy
      // argon2 verify before answering.
      expect(verifyPassword).toHaveBeenCalledTimes(1);

      // Both lockout keys were still recorded (the clamp happens inside
      // lib/lockout — the route passes the composed key; the lib-level
      // clamp is pinned by lockout-upsert.test.ts).
      expect(h.lockoutKeys.record.length).toBeGreaterThan(0);
      expect(h.lockoutKeys.record[0]!.startsWith("admin:")).toBe(true);
    } finally {
      close();
    }
  });

  it("a 255-char username (outer-perimeter boundary) still answers the uniform 401", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      h.dbReturnsAdmin = false;
      const res = await postLogin(url, { username: "y".repeat(255), password: "x" });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("a 256+-char username is rejected as INVALID shape at the perimeter (400, before any DB/argon2 work)", async () => {
    const app = buildApp();
    const { url, close } = await listen(app);
    try {
      h.dbReturnsAdmin = false;
      vi.mocked(verifyPassword).mockClear();
      const res = await postLogin(url, { username: "w".repeat(256), password: "x" });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      // Cheap rejection: no argon2 burn, no lockout accounting.
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(h.lockoutKeys.record).toHaveLength(0);
    } finally {
      close();
    }
  });
});
