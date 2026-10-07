import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { eq, sql } from "drizzle-orm";

/**
 * R122 (A9-5): pinning POST /api/auth/firebase/refresh — the silent
 * session-rotation route (routes/auth.ts:662-746).
 *
 * This route runs on EVERY frontend silent token renewal in production,
 * yet had ZERO tests (A9 P1-3 — its only reference was the path list in
 * csrf-gate.test.ts). Its siblings are covered: verifyFirebaseIdToken
 * forwarding is pinned in services/__tests__/firebase-auth.service.test.ts
 * and POST /api/auth/firebase/session in auth-firebase-session.test.ts.
 * This suite clones that harness (real authRouter over the pglite fixture
 * DB, lib/firebase-admin mocked to a controllable verifyIdToken) and pins
 * the refresh-specific contract:
 *
 *   1. missing/non-string id_token → 400 INVALID_DATA;
 *   2. a valid token → verifyIdToken is called with checkRevoked=TRUE
 *      (silent rotation enforces revocation — F-002), the user is
 *      resolved via the REAL resolveFirebaseSession, a NEW sessions row
 *      is minted, the httpOnly auth_token cookie is bound to that row
 *      (sessionId inside the JWT == the DB row), the body carries the
 *      98-F3 sentinel — and a second refresh mints a SECOND session row
 *      (rotation is per-call, not one-shot);
 *   3. an invalid Firebase token → 401 INVALID_TOKEN (the honest
 *      user-facing failure — NOT a 500) + an auth_activity failure row
 *      (identifier firebase_refresh_error, failureReason firebase_error);
 *   4. a Firebase service-side failure (auth/internal-error) → 503
 *      SERVICE_UNAVAILABLE;
 *   5. an UNKNOWN error (non-FirebaseAuthError — the database/network
 *      class) → 500 EXACTLY, never 401: the route's own comment
 *      (auth.ts:734-736) documents that a 401 here would trigger the
 *      frontend's onIdTokenChanged retry indefinitely — an infinite
 *      refresh loop. This is the deliberate anti-outage behavior this
 *      suite guards as a regression pin + the matching auth_activity
 *      failure row (failureReason unknown_error).
 *
 * resolveFirebaseSession is the ONE additionally-mocked boundary —
 * wrapped as vi.fn(realImplementation) so the success paths run the REAL
 * provisioning (user + identity + session rows on pglite) while the
 * unknown-error test can reject it once with a plain Error (the only
 * deterministic way to reach the route's non-Firebase catch arm).
 */

// ── Mocks (hoisted) — the auth-firebase-session.test.ts set + the one
// resolveFirebaseSession override explained above ────────────────────────────

const fb = vi.hoisted(() => ({
  decoded: null as Record<string, unknown> | null,
  rejectWith: null as (Error & { code?: string }) | null,
  verifyCalls: [] as Array<{ token: string; checkRevoked: boolean }>,
}));

vi.mock("../../lib/firebase-admin", () => ({
  getFirebaseAdminAuth: vi.fn(async () => ({
    verifyIdToken: vi.fn(async (token: string, checkRevoked?: boolean) => {
      fb.verifyCalls.push({ token, checkRevoked: !!checkRevoked });
      if (fb.rejectWith) throw fb.rejectWith;
      return fb.decoded;
    }),
    revokeRefreshTokens: vi.fn(async () => {}),
  })),
  getFirebaseAdminApp: vi.fn(async () => ({})),
}));

// Keep the account-link-consent + risk-config-cache import chains off the
// network; the null client engages the PG consent fallback (works on pglite).
vi.mock("../../lib/redis-client", () => ({
  getRedisClient: () => null,
  initRedisClient: async () => null,
  requireRedisClient: () => {
    throw new Error("redis not available in tests");
  },
  isRedisInitialised: () => false,
  isRedisConnected: () => false,
  stopPingWatchdog: () => {},
  noteRedisDegradedMode: () => {},
  trackRedisOp: async (_op: string, fn: () => Promise<unknown>) => fn(),
  withRedisCommandTimeout: async <T>(_op: string, fn: () => Promise<T>) => fn(),
  RedisCommandTimeoutError: class MockRedisCommandTimeoutError extends Error {},
}));

vi.mock("../../telegram", () => ({
  notifyNewUser: vi.fn(),
}));

vi.mock("../../services/firebase-auth.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/firebase-auth.service")>();
  return {
    ...actual,
    resolveFirebaseSession: vi.fn(actual.resolveFirebaseSession),
  };
});

import {
  db,
  initTestDb,
  resetTestDb,
  authActivityTable,
  sessionsTable,
  usersTable,
} from "../../test/db";
import { verifyUserToken } from "../../lib/jwt";
import { resolveFirebaseSession } from "../../services/firebase-auth.service";
import { authRouter } from "../auth";

const resolveSessionMock = vi.mocked(resolveFirebaseSession);

// ── Harness (auth-firebase-session.test.ts idiom) ───────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
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

/** JWT-shaped string ≥ 100 chars so verifyFirebaseIdToken's length guard passes. */
function makeIdToken(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(
    JSON.stringify({
      iss: "https://securetoken.google.com/test-project",
      aud: "test-project",
      sub: "uid-fake",
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { sign_in_provider: "google.com" },
      ...payload,
    }),
  ).toString("base64url");
  const sig = "fake-signature-segment-padded-to-be-long-enough-for-the-length-guard";
  return `${header}.${body}.${sig}`;
}

/** A fixed Google-shaped decoded token (mirrors firebase-admin's DecodedIdToken). */
function googleDecodedToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: "google-uid-333",
    aud: "test-project",
    sub: "google-uid-333",
    email: "rotating@example.com",
    email_verified: true,
    name: "Rotating User",
    picture: "https://example.com/pic.png",
    firebase: {
      sign_in_provider: "google.com",
      identities: { "google.com": ["g-333@example.com"] },
    },
    ...overrides,
  };
}

async function postRefresh(
  url: string,
  body: Record<string, unknown>,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}> {
  const res = await fetch(`${url}/api/auth/firebase/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    setCookie: res.headers.get("set-cookie"),
  };
}

function cookieToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const m = /auth_token=([^;]+)/.exec(setCookie);
  return m ? m[1]! : null;
}

async function authActivityRows() {
  return db.select().from(authActivityTable).orderBy(authActivityTable.id);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities + account_link_consents: not part of the shared
  // test DDL — this file owns them (same blocks as
  // auth-firebase-session.test.ts; the REAL resolveFirebaseSession writes
  // the identity row and consults the consent table).
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS user_auth_identities (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(50) NOT NULL,
  provider_uid varchar(255) NOT NULL,
  firebase_uid varchar(255),
  email varchar(255),
  phone varchar(20),
  email_verified boolean NOT NULL DEFAULT false,
  phone_verified boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_identities_provider_uid ON user_auth_identities (provider, provider_uid)`,
    ),
  );
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS account_link_consents (
  token text PRIMARY KEY,
  candidate_user_id integer NOT NULL,
  firebase_uid_hash text NOT NULL,
  expires_at timestamptz NOT NULL
)`),
  );
  // auth_activity: same block as auth-sessions.test.ts — every refresh
  // outcome (success AND both failure arms) writes an audit row here.
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS auth_activity (
  id serial PRIMARY KEY,
  user_id integer,
  identifier varchar(255) NOT NULL,
  action varchar(50) NOT NULL,
  provider varchar(50),
  success boolean NOT NULL,
  ip_address varchar(45),
  user_agent text,
  failure_reason varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  process.env.FIREBASE_PROJECT_ID = "test-project";
});

afterAll(() => {
  delete process.env.FIREBASE_PROJECT_ID;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(
    sql.raw("TRUNCATE user_auth_identities, account_link_consents, auth_activity CASCADE;"),
  );
  fb.decoded = googleDecodedToken();
  fb.rejectWith = null;
  fb.verifyCalls.length = 0;
  // mockClear (not reset): keeps the REAL resolveFirebaseSession as the
  // default implementation — only calls are wiped.
  resolveSessionMock.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/firebase/refresh — input perimeter", () => {
  it.each([
    ["body without id_token", {}],
    ["empty-string id_token", { id_token: "" }],
    ["non-string id_token (number)", { id_token: 12345 }],
  ])("%s → 400 INVALID_DATA before any verification", async (_label, body) => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postRefresh(url, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "رمز Firebase ID مطلوب",
        code: "INVALID_DATA",
      });
      expect(fb.verifyCalls).toHaveLength(0);
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });
});

describe("POST /api/auth/firebase/refresh — valid token (silent rotation)", () => {
  it("verifies with checkRevoked=TRUE, provisions via the real resolver, mints a session row bound to the cookie, and answers the sentinel shape", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const idToken = makeIdToken();
      const res = await postRefresh(url, { id_token: idToken });
      expect(res.status).toBe(200);

      // F-002 at the route level: silent rotation verifies WITH the
      // revocation check (a revoked Firebase session must not rotate).
      expect(fb.verifyCalls).toEqual([{ token: idToken, checkRevoked: true }]);

      // The user was really provisioned by the REAL resolver.
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.firebaseUid, "google-uid-333"));
      expect(user).toBeDefined();
      expect(user.email).toBe("rotating@example.com");

      // The body is the 98-F3 sentinel shape — never the raw JWT.
      expect(res.body).toMatchObject({
        token: "__cookie_session__",
        user: expect.objectContaining({
          id: user!.id,
          email: "rotating@example.com",
          email_verified: true,
          auth_provider: "firebase_google",
          wallet_balance: 0,
          referral_code: expect.stringMatching(/^[0-9A-F]{8}$/),
        }),
      });
      expect(JSON.stringify(res.body)).not.toContain(cookieToken(res.setCookie) ?? "___");

      // The httpOnly cookie carries a JWT bound to a REAL session row:
      // the sessionId inside the token == the row the route inserted.
      const cookie = cookieToken(res.setCookie);
      expect(cookie).toBeTruthy();
      expect(res.setCookie).toContain("HttpOnly");
      expect(res.setCookie).toContain("Max-Age=2592000"); // 30 days
      const verified = verifyUserToken(cookie!);
      expect(verified).toMatchObject({ userId: user!.id });
      const sessionRows = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.userId, user!.id));
      expect(sessionRows).toHaveLength(1);
      expect(verified!.sessionId).toBe(sessionRows[0]!.id);

      // Audit: the rotation is a logged-in event for the rotating user.
      const activity = await authActivityRows();
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        userId: user!.id,
        identifier: user!.phone, // phone is set (f_… placeholder) → identifier
        action: "login",
        provider: "firebase",
        success: true,
      });
    } finally {
      close();
    }
  });

  it("a SECOND refresh with the same token mints a SECOND session row (rotation is per-call — the device list grows)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const first = await postRefresh(url, { id_token: makeIdToken() });
      expect(first.status).toBe(200);
      const second = await postRefresh(url, { id_token: makeIdToken() });
      expect(second.status).toBe(200);

      const userId = (second.body.user as { id: number }).id;
      const sessionRows = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.userId, userId));
      expect(sessionRows).toHaveLength(2);

      // Each rotation's cookie is bound to ITS OWN fresh session row.
      const cookie2 = cookieToken(second.setCookie);
      const newest = [...sessionRows].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0]!;
      expect(verifyUserToken(cookie2!)!.sessionId).toBe(newest.id);
    } finally {
      close();
    }
  });
});

describe("POST /api/auth/firebase/refresh — FirebaseAuthError mapping (the honest user-facing failures)", () => {
  it("an invalid Firebase token → 401 INVALID_TOKEN (NOT a 500) + an auth_activity failure row, and no session is minted", async () => {
    fb.rejectWith = Object.assign(new Error("Firebase ID token has invalid signature"), {
      code: "auth/invalid-id-token",
    });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postRefresh(url, { id_token: makeIdToken() });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        error: "رمز Firebase غير صالح أو منتهي الصلاحية",
        code: "INVALID_TOKEN",
      });
      // No half-session: no cookie, no session row, no user provisioned.
      expect(res.setCookie).toBeNull();
      expect(await db.select().from(sessionsTable)).toHaveLength(0);
      expect(await db.select().from(usersTable)).toHaveLength(0);

      // The failure is audited under the refresh identifier.
      const activity = await authActivityRows();
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        identifier: "firebase_refresh_error",
        action: "login",
        provider: "firebase",
        success: false,
        failureReason: "firebase_error",
      });
    } finally {
      close();
    }
  });

  it("a Firebase service-side failure (auth/internal-error) → 503 SERVICE_UNAVAILABLE", async () => {
    fb.rejectWith = Object.assign(
      new Error("Failed to fetch service account credential (simulated Firebase outage)"),
      { code: "auth/internal-error" },
    );
    const { url, close } = await listen(buildApp());
    try {
      const res = await postRefresh(url, { id_token: makeIdToken() });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        error: "تعذّر التحقق من الرمز بسبب خطأ في إعدادات الخادم. يرجى التواصل مع الدعم.",
        code: "SERVICE_UNAVAILABLE",
      });
      expect(res.setCookie).toBeNull();
      expect(await db.select().from(sessionsTable)).toHaveLength(0);
    } finally {
      close();
    }
  });
});

describe("POST /api/auth/firebase/refresh — unknown-error 500 (the anti-infinite-loop pin)", () => {
  it("a NON-Firebase error → 500 EXACTLY (never 401) + INTERNAL_ERROR + the unknown_error audit row", async () => {
    // The regression this pins (auth.ts:734-736): a 401 on the refresh
    // route would make the frontend's onIdTokenChanged listener retry
    // indefinitely — an infinite refresh loop that DDoSes the backend
    // and locks users out of every silent renewal. Unknown errors
    // (database, network) must surface as 500 so the client gives up.
    resolveSessionMock.mockRejectedValueOnce(
      new Error("simulated database failure (ECONNREFUSED)"),
    );
    const { url, close } = await listen(buildApp());
    try {
      const res = await postRefresh(url, { id_token: makeIdToken() });
      expect(res.status).toBe(500);
      expect(res.status).not.toBe(401); // THE pin — explicit for reviewers
      expect(res.body).toMatchObject({
        error: "تعذّر تجديد الجلسة بسبب خطأ في الخادم. يرجى المحاولة لاحقاً.",
        code: "INTERNAL_ERROR",
      });

      // No session survived the failure.
      expect(res.setCookie).toBeNull();
      expect(await db.select().from(sessionsTable)).toHaveLength(0);

      // The unknown-error arm is audited with its distinct reason.
      const activity = await authActivityRows();
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        identifier: "firebase_refresh_error",
        action: "login",
        provider: "firebase",
        success: false,
        failureReason: "unknown_error",
      });

      // Belt: the once-rejection did not latch — the very next refresh
      // (backend recovered) rotates normally again.
      const recovered = await postRefresh(url, { id_token: makeIdToken() });
      expect(recovered.status).toBe(200);
      expect(recovered.setCookie).toContain("auth_token=");
    } finally {
      close();
    }
  });
});
