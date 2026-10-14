import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable } from "../../test/db";

/**
 * R146 audit F3 — Firebase first-login double-submit race (WhatsApp F6
 * parity, mirrored from telegram-auth-double-submit.test.ts).
 *
 * A double-tap on the Google sign-in button sends two concurrent session
 * requests with the same idToken: both pass verification, both miss step 1
 * (no user by firebase_uid) and step 3 (no link candidates), and both
 * INSERT — the loser tripped users.firebase_uid / phone UNIQUE (both
 * compute the same `f_<sha(uid)>` placeholder) as an unclassified 23505 →
 * raw 500 for a registration that actually succeeded (the winner's request
 * created the account). Retry worked; the user saw a scary 500 once.
 *
 * Fix under test: the INSERT's 23505 is caught, the winner's row is
 * re-read by firebase_uid, and the loser gets a normal
 * `isNewUser: false` login result.
 *
 * Race simulation: findLinkCandidates' projected identity lookup is the
 * LAST select before the INSERT — its rows are delivered only AFTER the
 * "concurrent winner's" INSERT commits on the session.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle builder
   internals are intentionally opaque (same caveat as the F6 test this
   mirrors). */

vi.mock("../../lib/firebase-admin", () => ({
  getFirebaseAdminAuth: vi.fn(async () => ({
    verifyIdToken: vi.fn(async () => ({})),
    revokeRefreshTokens: vi.fn(async () => {}),
  })),
  getFirebaseAdminApp: vi.fn(async () => ({})),
}));

// Keep the account-link-consent import chain off the network (same mock
// block as auth-firebase-session.test.ts).
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

import { resolveFirebaseSession } from "../firebase-auth.service";

/** Wrap `db.select` so the first matching SELECT delivers its rows only
 * AFTER `writer()` ran on the real session — a concurrent committed writer
 * landing inside the read→write window. */
function interleaveAfterDbSelect(
  matchSelectFields: (fields: unknown) => boolean,
  writer: () => Promise<void>,
): () => void {
  const original = db.select.bind(db);
  const armed = { done: false };
  const spy = vi.spyOn(db, "select").mockImplementation((...args: unknown[]) => {
    const builder = original(...(args as [any]));
    if (!armed.done && matchSelectFields(args[0])) {
      armed.done = true;
      return wrapThenable(builder, writer);
    }
    return builder;
  });
  return () => spy.mockRestore();
}

function wrapThenable(builder: any, runWriter: () => Promise<void>): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "then") {
        return (onFulfilled?: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) =>
          target.then(async (rows: unknown) => {
            await runWriter();
            return onFulfilled ? onFulfilled(rows) : rows;
          }, onRejected);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result !== null && typeof result === "object") {
          return wrapThenable(result, runWriter);
        }
        return result;
      };
    },
  });
}

/** findLinkCandidates' identity lookup projects exactly { userId }. */
function isIdentityUserIdSelect(fields: unknown): boolean {
  return (
    !!fields &&
    typeof fields === "object" &&
    Object.keys(fields as object).length === 1 &&
    "userId" in (fields as object)
  );
}

const UID = "google-uid-race-146";
// Same placeholder the service computes for a phone-less Google token.
const PLACEHOLDER = `f_${createHash("sha256").update(UID).digest("hex").slice(0, 18)}`;

/** A fixed Google-shaped decoded token (mirrors firebase-admin's DecodedIdToken). */
function googleDecodedToken(): Record<string, unknown> {
  return {
    uid: UID,
    aud: "test-project",
    sub: UID,
    email: "racer@example.com",
    email_verified: true,
    name: "Race User",
    picture: null,
    firebase: {
      sign_in_provider: "google.com",
      identities: { "google.com": ["g-racer@example.com"] },
    },
  };
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities is not part of the shared test DDL — findLinkCandidates
  // reads it (same block as auth-firebase-session.test.ts).
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
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R146 F3 — Firebase first-login double-submit returns the winner's row", () => {
  it("loser of the users-INSERT race gets a normal isNewUser:false login on the winner's row (no 23505 → 500)", async () => {
    // The concurrent winner: the same idToken's request commits the user
    // INSERT right after findLinkCandidates' identity lookup read the
    // (still empty) table — the loser's INSERT then collides on
    // users.firebase_uid / phone UNIQUE.
    const restore = interleaveAfterDbSelect(isIdentityUserIdSelect, async () => {
      await db.execute(
        sql`INSERT INTO users (phone, firebase_uid, google_id, auth_provider) VALUES (${PLACEHOLDER}, ${UID}, ${"g-racer@example.com"}, 'firebase_google')`,
      );
    });

    let result: Awaited<ReturnType<typeof resolveFirebaseSession>>;
    try {
      result = await resolveFirebaseSession(googleDecodedToken() as any);
    } finally {
      restore();
    }

    // A normal login on the winner's row — NOT the raw 23505 throw the
    // route's generic error branch used to 500 on.
    expect(result.isNewUser).toBe(false);
    expect(result.provider).toBe("google.com");
    expect(result.user.firebaseUid).toBe(UID);
    expect(result.user.phone).toBe(PLACEHOLDER);

    // Exactly ONE user for the firebase uid — the winner's row.
    const rows = await db.select().from(usersTable).where(eq(usersTable.firebaseUid, UID));
    expect(rows).toHaveLength(1);
  });
});
