import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { sql } from "drizzle-orm";

/**
 * R187 (F6) — the firebase session-mint referral_code cap.
 *
 * POST /api/auth/firebase/session was the only provider mint that did NOT
 * cap the referral code at 16 chars (auth-whatsapp.ts /whatsapp/verify
 * and auth-settings.ts /telegram/webapp both carry
 * `.trim().toUpperCase().slice(0, 16)`) — an unbounded code flowed raw
 * into the resolver's referral lookup. Pinned here at the resolver seam
 * (the whatsapp/verify suite's mock-seam idiom): the ROUTE's
 * normalization contract — trim → uppercase → 16-char cap, non-string →
 * undefined — exactly as the siblings behave.
 *
 * Harness: the auth-firebase-refresh.test.ts set (real authRouter over
 * the pglite fixture DB, lib/firebase-admin mocked to a fixed decoded
 * token, resolveFirebaseSession wrapped as vi.fn(real) so the arg is
 * observable while the real provisioning still runs).
 */

const fb = vi.hoisted(() => ({
  decoded: null as Record<string, unknown> | null,
}));

vi.mock("../../lib/firebase-admin", () => ({
  getFirebaseAdminAuth: vi.fn(async () => ({
    verifyIdToken: vi.fn(async () => fb.decoded),
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

import { db, initTestDb, resetTestDb } from "../../test/db";
import { resolveFirebaseSession } from "../../services/firebase-auth.service";
import { authRouter } from "../auth";

const resolveSessionMock = vi.mocked(resolveFirebaseSession);

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
function makeIdToken(): string {
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
    }),
  ).toString("base64url");
  const sig = "fake-signature-segment-padded-to-be-long-enough-for-the-length-guard";
  return `${header}.${body}.${sig}`;
}

async function postSession(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/auth/firebase/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities + account_link_consents + auth_activity: same
  // blocks as auth-firebase-session.test.ts (the REAL resolver writes the
  // identity row; the route's logAuthActivity writes the audit row).
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
  fb.decoded = {
    uid: "google-uid-f6",
    aud: "test-project",
    sub: "google-uid-f6",
    email: "f6@example.com",
    email_verified: true,
    name: "F6 User",
    firebase: {
      sign_in_provider: "google.com",
      identities: { "google.com": ["f6@example.com"] },
    },
  };
  resolveSessionMock.mockClear();
});

describe("R187 (F6) — referralCode normalization on POST /firebase/session", () => {
  it("a 300-char referral_code reaches the resolver capped at 16 chars (the sibling mints' contract)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, {
        id_token: makeIdToken(),
        referral_code: "a".repeat(300),
      });
      expect(res.status).toBe(201);

      expect(resolveSessionMock).toHaveBeenCalledTimes(1);
      const forwarded = resolveSessionMock.mock.calls[0]![1];
      // THE FIX: trim → uppercase → slice(0, 16) — byte-identical to the
      // whatsapp/verify + telegram/webapp sibling mints.
      expect(forwarded).toBe("A".repeat(16));
    } finally {
      close();
    }
  });

  it("a normal code is forwarded trimmed + uppercased (the pre-existing behavior, unchanged)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, {
        id_token: makeIdToken(),
        referral_code: "  ref12345  ",
      });
      expect(res.status).toBe(201);

      expect(resolveSessionMock.mock.calls[0]![1]).toBe("REF12345");
    } finally {
      close();
    }
  });

  it("a non-string referral_code is forwarded as undefined (no attribution)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, {
        id_token: makeIdToken(),
        referral_code: 12345,
      });
      expect(res.status).toBe(201);

      expect(resolveSessionMock.mock.calls[0]![1]).toBeUndefined();
    } finally {
      close();
    }
  });
});
