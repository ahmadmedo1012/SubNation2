import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, referralEventsTable, resetTestDb, usersTable } from "../../test/db";

/**
 * R188-1 (C-F1) — the referral_events INSERT rides the user-creation
 * transaction on the Telegram and Firebase channels (the
 * whatsapp-otp.service.ts house idiom).
 *
 * The defect: after the creation `db.transaction` (users INSERT only),
 * the referral event insert ran as a separate autocommit write. A failure
 * of that single INSERT (transient blip / crash between commits) left a
 * HALF-REFERRAL with no self-heal — users.referred_by set, the event row
 * never landed, and the signup 500'd; the retry takes the existing-user
 * path which never re-reaches the event insert. TopupService.approve
 * awards the referrer's +50 points only when the event row exists, so the
 * award silently never paid while the referee's welcome bonus (keyed on
 * referredBy alone) still did.
 *
 * Pin per channel:
 *   1. happy path — referred signup commits user + pending event together;
 *   2. atomicity — forcing the referral_events INSERT to fail at the DB
 *      level rolls the USER creation back with it (no half-referral). The
 *      forced failure is a CHECK violation (23514): NOT a unique violation,
 *      so `.onConflictDoNothing()` cannot swallow it and the service's
 *      23505 race-loser catch cannot reclassify it — it surfaces exactly
 *      like a transient insert blip.
 */

// Same mock blocks as firebase-auth-double-submit.test.ts: keep the
// firebase-admin + account-link-consent import chains off the network.
vi.mock("../../lib/firebase-admin", () => ({
  getFirebaseAdminAuth: vi.fn(async () => ({
    verifyIdToken: vi.fn(async () => ({})),
    revokeRefreshTokens: vi.fn(async () => {}),
  })),
  getFirebaseAdminApp: vi.fn(async () => ({})),
}));

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

/* eslint-disable @typescript-eslint/no-explicit-any -- the decoded Firebase
   token is a plain Record standing in for firebase-admin's DecodedIdToken
   (same caveat as firebase-auth-double-submit.test.ts). */

import { findOrCreateTelegramUser } from "../telegram-auth-flow";
import { resolveFirebaseSession } from "../firebase-auth.service";

const PIN_BLOCK = "chk_r188_pin_no_pending";

/** Force the referral_events INSERT (status 'pending') to fail at the DB
 * level — 23514 is not 23505, so onConflictDoNothing lets it throw. */
async function blockPendingReferralEvents(): Promise<void> {
  await db.execute(
    sql.raw(
      `ALTER TABLE referral_events ADD CONSTRAINT ${PIN_BLOCK} CHECK (status IS DISTINCT FROM 'pending')`,
    ),
  );
}

async function unblockPendingReferralEvents(): Promise<void> {
  await db.execute(sql.raw(`ALTER TABLE referral_events DROP CONSTRAINT ${PIN_BLOCK}`));
}

let phoneSeq = 915_500_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

let tgSeq = 650_000_000;

async function seedReferrer(code: string): Promise<typeof usersTable.$inferSelect> {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), referralCode: code, walletBalance: "0.00" })
    .returning();
  return u!;
}

/** A minimal valid TelegramAuthFields shape (id is the only linkage key). */
function tgFields(): { id: string; first_name: string; auth_date: string; hash: string } {
  tgSeq += 1;
  const id = String(tgSeq);
  return {
    id,
    first_name: "Pin",
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: `pin_${id}`,
  };
}

/** A fixed Google-shaped decoded token (mirrors firebase-admin's DecodedIdToken). */
function googleDecodedToken(uid: string, email: string): Record<string, unknown> {
  return {
    uid,
    aud: "test-project",
    sub: uid,
    email,
    email_verified: true,
    name: "R188 Pin",
    picture: null,
    firebase: {
      sign_in_provider: "google.com",
      identities: { "google.com": [`g-${email}`] },
    },
  };
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities is not part of the shared test DDL — the creation
  // paths mirror into it (same block as firebase-auth-double-submit.test.ts).
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
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R188-1 (C-F1) — Telegram: the referral event rides the user-creation tx", () => {
  it("referred Telegram signup commits user + pending event together", async () => {
    const referrer = await seedReferrer("R188TG01");
    const fields = tgFields();

    const { user, isNewUser } = await findOrCreateTelegramUser(fields, "R188TG01");

    expect(isNewUser).toBe(true);
    expect(user.referredBy).toBe(referrer.id);
    const [event] = await db
      .select()
      .from(referralEventsTable)
      .where(eq(referralEventsTable.refereeId, user.id));
    expect(event).toBeDefined();
    expect(event!.referrerId).toBe(referrer.id);
    expect(event!.status).toBe("pending");
  });

  it("a referral-event INSERT failure rolls the user creation back with it (no half-referral)", async () => {
    const referrer = await seedReferrer("R188TG02");
    const fields = tgFields();

    await blockPendingReferralEvents();
    try {
      await expect(findOrCreateTelegramUser(fields, "R188TG02")).rejects.toThrow();

      // THE FIX: the users INSERT rolled back WITH the failed event INSERT —
      // no committed row carrying referred_by with no event row (the
      // half-referral TopupService.approve can never pay while the welcome
      // bonus, keyed on referredBy alone, still fires).
      const rows = await db.select().from(usersTable).where(eq(usersTable.telegramId, fields.id));
      expect(rows).toHaveLength(0);
      expect(await db.select().from(referralEventsTable)).toHaveLength(0);
      // The referrer side is untouched too.
      const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
      expect(r!.loyaltyPoints).toBe(0);
    } finally {
      await unblockPendingReferralEvents();
    }
  });
});

describe("R188-1 (C-F1) — Firebase: the referral event rides the user-creation tx", () => {
  it("referred Firebase signup commits user + pending event together", async () => {
    const referrer = await seedReferrer("R188FB01");
    const decoded = googleDecodedToken("r188-pin-tg-happy", "pin1@example.com");

    const result = await resolveFirebaseSession(decoded as any, "R188FB01");

    expect(result.isNewUser).toBe(true);
    expect(result.user.referredBy).toBe(referrer.id);
    const [event] = await db
      .select()
      .from(referralEventsTable)
      .where(eq(referralEventsTable.refereeId, result.user.id));
    expect(event).toBeDefined();
    expect(event!.referrerId).toBe(referrer.id);
    expect(event!.status).toBe("pending");
  });

  it("a referral-event INSERT failure rolls the user creation back with it (no half-referral)", async () => {
    const referrer = await seedReferrer("R188FB02");
    const uid = "r188-pin-fb-sad";
    const decoded = googleDecodedToken(uid, "pin2@example.com");

    await blockPendingReferralEvents();
    try {
      await expect(resolveFirebaseSession(decoded as any, "R188FB02")).rejects.toThrow();

      // THE FIX (same shape as the Telegram leg): the users INSERT rolled
      // back WITH the failed event INSERT — no committed firebaseUid row
      // carrying referred_by with no event row.
      const rows = await db.select().from(usersTable).where(eq(usersTable.firebaseUid, uid));
      expect(rows).toHaveLength(0);
      expect(await db.select().from(referralEventsTable)).toHaveLength(0);
      const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
      expect(r!.loyaltyPoints).toBe(0);
    } finally {
      await unblockPendingReferralEvents();
    }
  });
});
