import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { eq, sql } from "drizzle-orm";

/**
 * R118-A5 TOP-20 #2 [P1] — POST /api/auth/firebase/session.
 *
 * The login path's actual job (user provisioning tx, referral event,
 * identity upsert, session issuance — services/firebase-auth.service.ts,
 * 637 lines) had ZERO assertions: the only existing suite
 * (firebase-auth.service.test.ts) pins the checkRevoked flag-forwarding
 * and nothing else (A5 W-1). This suite mounts the REAL authRouter over
 * the pglite fixture DB with lib/firebase-admin mocked to a fixed decoded
 * token and pins the full provisioning contract:
 *
 *   1. a valid idToken provisions the user (firebaseUid, googleId,
 *      referralCode, balance 0.00), writes the session row + the
 *      user_auth_identities row, and answers 201 + the 98-F3 cookie
 *      sentinel (never a raw JWT in the body);
 *   2. re-login with the SAME uid resolves the SAME user (no duplicate)
 *      and issues a SECOND session row;
 *   3. an existing-phone user reached via a different provider goes
 *      through the F-003 two-phase consent flow — 409 link_consent_required
 *      with a masked hint (NO silent link, NO 500), then the consented
 *      re-submit commits the identity link onto the existing user;
 *   4. referral_code attaches a PENDING referral_events row and grants NO
 *      welcome credit (R115 policy B — the bonus lands on the first
 *      APPROVED topup, never at signup);
 *   5. an invalid token → 401 with zero rows written.
 *
 * Redis is mocked to a null client so the account-link-consent PG
 * fallback (round-97 F2) backs the consent tokens — the exact
 * no-Redis production shape.
 */

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

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

// notifyNewUser on the new-user path is fire-and-forget Telegram dispatch.
vi.mock("../../telegram", () => ({
  notifyNewUser: vi.fn(),
}));

import {
  db,
  initTestDb,
  referralEventsTable,
  resetTestDb,
  sessionsTable,
  userAuthIdentitiesTable,
  usersTable,
} from "../../test/db";
import { authRouter } from "../auth";

// ── Harness ──────────────────────────────────────────────────────────────────

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
    uid: "google-uid-111",
    aud: "test-project",
    sub: "google-uid-111",
    email: "newbie@example.com",
    email_verified: true,
    name: "New User",
    picture: "https://example.com/pic.png",
    firebase: {
      sign_in_provider: "google.com",
      identities: { "google.com": ["g-111@example.com"] },
    },
    ...overrides,
  };
}

async function postSession(
  url: string,
  body: Record<string, unknown>,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}> {
  const res = await fetch(`${url}/api/auth/firebase/session`, {
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

async function countRows(
  table: Parameters<ReturnType<typeof db.select>["from"]>[0],
  where?: ReturnType<typeof eq>,
): Promise<number> {
  // Generic table counter (users, sessions, identities, referrals — A5 #2).
  const q = db
    .select({ id: sql`1` })
    .from(table)
    .$dynamic();
  const rows = where ? await q.where(where) : await q;
  return rows.length;
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities is not part of the shared test DDL — this file
  // owns it (same block as auth-unlink.test.ts, mirrors
  // shared/db/src/schema/user_auth_identities.ts).
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
  // Same idempotent shape the account-link-consent lib creates lazily on
  // its PG fallback — created here so the per-test TRUNCATE always finds it.
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS account_link_consents (
  token text PRIMARY KEY,
  candidate_user_id integer NOT NULL,
  firebase_uid_hash text NOT NULL,
  expires_at timestamptz NOT NULL
)`),
  );
  process.env.FIREBASE_PROJECT_ID = "test-project";
});

afterAll(() => {
  delete process.env.FIREBASE_PROJECT_ID;
});

beforeEach(async () => {
  await resetTestDb();
  // user_auth_identities / account_link_consents are not in the shared
  // TRUNCATE list — clear them here (consent rows are one-shot anyway).
  await db.execute(sql.raw("TRUNCATE user_auth_identities, account_link_consents CASCADE;"));
  fb.decoded = googleDecodedToken();
  fb.rejectWith = null;
  fb.verifyCalls.length = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/firebase/session — provisioning (R118-A5 #2)", () => {
  it("a valid idToken provisions the user (firebaseUid, googleId, referralCode, balance 0.00) and creates session + identity rows", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, { id_token: makeIdToken() });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        is_new_user: true,
        provider: "google.com",
        // 98-F3: the body token is the sentinel — the httpOnly cookie is
        // the sole session transport.
        token: "__cookie_session__",
        needs_phone: true,
        user: {
          phone: expect.stringMatching(/^f_[0-9a-f]{18}$/),
          email: "newbie@example.com",
          email_verified: true,
          phone_verified: false,
          auth_provider: "firebase_google",
          wallet_balance: 0,
          referral_code: expect.stringMatching(/^[0-9A-F]{8}$/),
          display_name: "New User",
        },
      });
      // The httpOnly session cookie rides the response.
      expect(res.setCookie).toContain("auth_token=");

      const userId = (res.body.user as { id: number }).id;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      expect(user.firebaseUid).toBe("google-uid-111");
      expect(user.googleId).toBe("g-111@example.com");
      expect(String(user.walletBalance)).toBe("0.00");
      expect(user.referredBy).toBeNull();

      // Session row: the server-side revocation truth (V1-H3).
      expect(await countRows(sessionsTable, eq(sessionsTable.userId, userId))).toBe(1);

      // Identity row: the providers/linked surface's backing store.
      const identities = await db
        .select()
        .from(userAuthIdentitiesTable)
        .where(eq(userAuthIdentitiesTable.userId, userId));
      expect(identities).toHaveLength(1);
      expect(identities[0]).toMatchObject({
        provider: "google.com",
        providerUid: "g-111@example.com",
        firebaseUid: "google-uid-111",
        email: "newbie@example.com",
        emailVerified: true,
      });
    } finally {
      close();
    }
  });

  it("re-login with the SAME uid resolves the SAME user and issues a second session (no duplicate user)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const first = await postSession(url, { id_token: makeIdToken() });
      expect(first.status).toBe(201);
      const firstUserId = (first.body.user as { id: number }).id;

      const second = await postSession(url, { id_token: makeIdToken() });
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ is_new_user: false, provider: "google.com" });
      expect((second.body.user as { id: number }).id).toBe(firstUserId);

      // Exactly ONE user row for the uid — login never duplicates.
      expect(await countRows(usersTable, eq(usersTable.firebaseUid, "google-uid-111"))).toBe(1);
      // TWO session rows (device list backing store).
      expect(await countRows(sessionsTable, eq(sessionsTable.userId, firstUserId))).toBe(2);
      // The identity upsert keeps ONE (provider, provider_uid) row.
      expect(
        await countRows(userAuthIdentitiesTable, eq(userAuthIdentitiesTable.userId, firstUserId)),
      ).toBe(1);
    } finally {
      close();
    }
  });

  it("an existing-phone user via a different provider → 409 link_consent_required with a masked hint (no silent link, no 500), then the consented re-submit links the identity", async () => {
    // A WhatsApp-era user with a normalized Libyan phone and NO firebase link.
    const [existing] = await db
      .insert(usersTable)
      .values({ phone: "912345678", referralCode: "EXIST000" })
      .returning();

    fb.decoded = googleDecodedToken({
      uid: "google-uid-222",
      sub: "google-uid-222",
      email: null,
      email_verified: false,
      name: null,
      picture: null,
      phone_number: "+218912345678",
      firebase: {
        sign_in_provider: "google.com",
        identities: { "google.com": ["g-222@example.com"] },
      },
    });

    const { url, close } = await listen(buildApp());
    try {
      // Phase 1 — F-003: single link candidate ⇒ refuse to commit, issue
      // a consent token, surface a masked hint.
      const refused = await postSession(url, { id_token: makeIdToken() });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        success: false,
        // R123-E5 (A6 P2-3): the envelope contract — every documented
        // route's error body carries the machine-readable {error, code};
        // the repo's conflict-family code (same as wallet/orders/loyalty).
        code: "CONFLICT",
        reason: "link_consent_required",
        candidate_hint: { maskedPhone: "9••••••78", maskedEmail: null },
      });
      const linkToken = refused.body.link_token;
      expect(typeof linkToken).toBe("string");
      expect(linkToken as string).toMatch(/^[0-9a-f]{64}$/);

      // Nothing was committed by the refusal: no firebaseUid on the
      // candidate, no duplicate user, no session, no identity row.
      const [stillUnlinked] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, existing.id));
      expect(stillUnlinked.firebaseUid).toBeNull();
      expect(await countRows(usersTable)).toBe(1);
      expect(await countRows(sessionsTable)).toBe(0);
      expect(await countRows(userAuthIdentitiesTable)).toBe(0);

      // Phase 2 — the user confirms: same id_token + the consent token.
      const linked = await postSession(url, {
        id_token: makeIdToken(),
        link_consent_token: linkToken,
      });
      expect(linked.status).toBe(200);
      expect(linked.body).toMatchObject({ is_new_user: false });
      expect((linked.body.user as { id: number }).id).toBe(existing.id);

      // The link is committed ONTO the existing user — still no duplicate.
      expect(await countRows(usersTable)).toBe(1);
      const [linkedUser] = await db.select().from(usersTable).where(eq(usersTable.id, existing.id));
      expect(linkedUser.firebaseUid).toBe("google-uid-222");
      expect(linkedUser.authProvider).toBe("firebase_google");
      const identities = await db
        .select()
        .from(userAuthIdentitiesTable)
        .where(eq(userAuthIdentitiesTable.userId, existing.id));
      expect(identities).toHaveLength(1);
      expect(identities[0]).toMatchObject({
        provider: "google.com",
        providerUid: "g-222@example.com",
        firebaseUid: "google-uid-222",
      });
      expect(await countRows(sessionsTable, eq(sessionsTable.userId, existing.id))).toBe(1);
    } finally {
      close();
    }
  });

  it("referral_code attaches a PENDING referral_events row and grants NO welcome credit (R115 policy B)", async () => {
    const [referrer] = await db
      .insert(usersTable)
      .values({ phone: "930000001", referralCode: "REF12345", walletBalance: "0.00" })
      .returning();

    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, {
        id_token: makeIdToken(),
        referral_code: "ref12345", // route trims + uppercases
      });
      expect(res.status).toBe(201);
      const newUser = res.body.user as { id: number; referral_code: string | null };
      expect(newUser.id).not.toBe(referrer.id);

      // The new user carries the referral attribution…
      const [created] = await db.select().from(usersTable).where(eq(usersTable.id, newUser.id));
      expect(created.referredBy).toBe(referrer.id);
      // …the event is PENDING (credited on first approved topup, not now)…
      const events = await db
        .select()
        .from(referralEventsTable)
        .where(eq(referralEventsTable.referrerId, referrer.id));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ refereeId: created.id, status: "pending" });
      expect(events[0].creditedAt).toBeNull();
      // …and NEITHER side was credited at signup.
      expect(String(created.walletBalance)).toBe("0.00");
      expect(created.welcomeBonusGranted).toBe(false);
      const [referrerAfter] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, referrer.id));
      expect(String(referrerAfter.walletBalance)).toBe("0.00");
    } finally {
      close();
    }
  });

  it("an invalid token → 401 with ZERO rows written (no provisioning side effects)", async () => {
    fb.rejectWith = Object.assign(new Error("Firebase ID token has invalid signature"), {
      code: "auth/invalid-id-token",
    });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, { id_token: makeIdToken() });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "INVALID_TOKEN" });

      expect(await countRows(usersTable)).toBe(0);
      expect(await countRows(sessionsTable)).toBe(0);
      expect(await countRows(userAuthIdentitiesTable)).toBe(0);
      expect(await countRows(referralEventsTable)).toBe(0);
    } finally {
      close();
    }
  });

  it("a phone-provider Firebase token is refused 403 (Firebase Phone OTP retired — WhatsApp only)", async () => {
    fb.decoded = googleDecodedToken({
      firebase: { sign_in_provider: "phone", identities: { phone: ["+218912345678"] } },
    });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postSession(url, { id_token: makeIdToken() });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FEATURE_DISABLED" });
      expect(await countRows(usersTable)).toBe(0);
    } finally {
      close();
    }
  });
});
