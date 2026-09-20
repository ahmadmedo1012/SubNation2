import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import {
  db,
  initTestDb,
  referralEventsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { signTelegramWebAppFixture } from "../../lib/telegram-auth";
import { __test as replayTestHooks } from "../../lib/telegram-replay";
import { authProviderPublicRouter } from "../auth-settings";

/**
 * F-16 / 93-A2 P1-3 (round-93) — referral signup-bonus gate on the
 * Telegram Mini App flow + 93-A1 S3 replay dedup at the route level.
 *
 * The instant 5.00 LYD wallet credit to the REFEREE used to be granted at
 * Telegram signup purely for supplying any valid referral code — free
 * Telegram accounts (phone is the `tg_<id>` placeholder) made this
 * farmable at scale (~960 signups/day/IP ⇒ ~4,800 LYD/day of spendable
 * balance against real inventory). The gate: the bonus is credited only
 * when the account carries a verified phone, which a Telegram signup
 * never does — so the bonus is DEFERRED (relationship + referral_events
 * row still recorded in full; a future credit-on-first-approved-topup
 * can award it there, mirroring the referrer's topup-gated 50 points).
 *
 * ⚠️ Operator revertable: see REFERRAL_SIGNUP_BONUS_REQUIRES_PHONE_VERIFICATION
 * in routes/auth-settings.ts (single constant; the loud comment there
 * documents the revert path). These tests pin the CURRENT policy.
 *
 * Requires tables the shared test DDL does not carry: system_settings
 * (getSetting) and user_auth_identities (identity mirroring) — this file
 * owns their DDL, mirroring shared/db/src/schema/*.
 */

const BOT_TOKEN = "1234567890:AAH-test-bot-token-not-real-do-not-reuse";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authProviderPublicRouter);
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

let tgSeq = 500_000_000;

/** A fresh, valid, freshly-dated initData payload for a unique Telegram user. */
function freshInitData(): { initData: string; tgId: string } {
  tgSeq += 1;
  const initData = signTelegramWebAppFixture(
    {
      user: { id: tgSeq, first_name: "Farm", username: `farm_${tgSeq}` },
      auth_date: Math.floor(Date.now() / 1000),
    },
    BOT_TOKEN,
  );
  return { initData, tgId: String(tgSeq) };
}

async function seedReferrer(): Promise<{ userId: number; code: string }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      phone: "921000001",
      referralCode: "FARMER01",
      walletBalance: "0.00",
    })
    .returning();
  return { userId: u.id, code: "FARMER01" };
}

interface WebappResponse {
  status: number;
  body: { token?: string; is_new_user?: boolean; code?: string; reason?: string; error?: string };
}

async function postWebapp(url: string, body: Record<string, unknown>): Promise<WebappResponse> {
  const res = await fetch(`${url}/api/auth/telegram/webapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as WebappResponse["body"] };
}

async function getUserByTelegramId(tgId: string): Promise<typeof usersTable.$inferSelect> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId)).limit(1);
  return row!;
}

beforeAll(async () => {
  await initTestDb();
  // pglite executes ONE statement per prepared query — split the DDL.
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(255) PRIMARY KEY,
  value text NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
)`),
  );
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
  // Enable the Telegram provider with the test bot token (the settings row
  // the operator configures from the admin providers UI).
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({ enabled: true, bot_token: BOT_TOKEN })})`,
  );
});

beforeEach(async () => {
  // users / referral_events / wallet_ledger come back via the shared
  // reset; system_settings + user_auth_identities are NOT in its TRUNCATE
  // list — clear them here, then re-seed the provider config.
  await resetTestDb();
  await db.execute(sql.raw(`DELETE FROM user_auth_identities;`));
  await db.execute(sql`DELETE FROM system_settings WHERE key = 'auth.telegram'`);
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({ enabled: true, bot_token: BOT_TOKEN })})`,
  );
  // Isolate the in-memory replay store (93-A1 S3 fallback) between cases.
  replayTestHooks.resetMemoryStore();
});

describe("F-16 — referral signup bonus gate on the Mini App flow", () => {
  it("signup WITH a valid referral code: account created, referral relationship recorded, but NO instant 5 LYD (the farm vector closed)", async () => {
    const referrer = await seedReferrer();
    const { initData, tgId } = freshInitData();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await postWebapp(url, {
        initData,
        referralCode: referrer.code,
      });
      // The signup flow itself is NOT broken — session minted (98-F3:
      // the body `token` is the cookie-session SENTINEL, not a raw JWT —
      // the httpOnly cookie is the sole session transport now, mirroring
      // the admin R97-02 posture).
      expect(status).toBe(200);
      expect(body.is_new_user).toBe(true);
      expect(body.token).toBe("__cookie_session__");

      const user = await getUserByTelegramId(tgId);
      expect(user).toBeDefined();
      // THE GATE: no spendable balance at signup time.
      expect(String(user.walletBalance)).toBe("0.00");
      // The referral relationship survives (deferral, not deletion).
      expect(user.referredBy).toBe(referrer.userId);

      // Ledger parity: no balance ⇒ no referral_credit ledger row.
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, user.id));
      expect(ledger).toHaveLength(0);

      // The referral event row exists (pending) — a future credit-on-
      // first-approved-topup hook (and the referrer's topup-gated 50
      // points) still have their trigger.
      const [event] = await db
        .select()
        .from(referralEventsTable)
        .where(eq(referralEventsTable.refereeId, user.id));
      expect(event).toBeDefined();
      expect(event.status).toBe("pending");
      expect(event.referrerId).toBe(referrer.userId);
    } finally {
      close();
    }
  });

  it("signup WITHOUT a referral code: unchanged legacy behaviour (0 balance)", async () => {
    const { initData, tgId } = freshInitData();
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await postWebapp(url, { initData });
      expect(status).toBe(200);
      const user = await getUserByTelegramId(tgId);
      expect(String(user.walletBalance)).toBe("0.00");
      expect(user.referredBy).toBeNull();
      const events = await db.select().from(referralEventsTable);
      expect(events).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("unknown referral code: signup succeeds, no relationship, no bonus", async () => {
    const { initData, tgId } = freshInitData();
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await postWebapp(url, { initData, referralCode: "NOPE42" });
      expect(status).toBe(200);
      const user = await getUserByTelegramId(tgId);
      expect(user.referredBy).toBeNull();
      expect(String(user.walletBalance)).toBe("0.00");
    } finally {
      close();
    }
  });

  it("the referrer side is untouched by the gate (no credit at signup either)", async () => {
    const referrer = await seedReferrer();
    const { initData } = freshInitData();
    const { url, close } = await listen(buildApp());
    try {
      await postWebapp(url, { initData, referralCode: referrer.code });
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.userId));
      // No 50 points either — the referrer award is (and always was)
      // gated behind the referee's first APPROVED topup, not signup.
      expect(row.loyaltyPoints).toBe(0);
      expect(String(row.walletBalance)).toBe("0.00");
    } finally {
      close();
    }
  });
});

describe("93-A1 S3 — replay dedup at the route level (no-Redis production shape)", () => {
  it("the SAME initData cannot be replayed: second POST → 401 replay_detected", async () => {
    const { initData } = freshInitData();
    const { url, close } = await listen(buildApp());
    try {
      const first = await postWebapp(url, { initData, referralCode: "FARMER01" });
      expect(first.status).toBe(200);

      // The captured payload replayed (the S3 attack: freshness still
      // passes, the hash must not be re-claimable).
      const second = await postWebapp(url, { initData, referralCode: "FARMER01" });
      expect(second.status).toBe(401);
      expect(second.body.code).toBe("replay_detected");
      // Only ONE user row for the Telegram id — no second session minted.
      const rows = await db.select().from(usersTable);
      expect(rows.filter((u) => u.authProvider === "telegram")).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("a DIFFERENT initData (fresh Telegram user) is not blocked by the replay store", async () => {
    const a = freshInitData();
    const b = freshInitData();
    const { url, close } = await listen(buildApp());
    try {
      const first = await postWebapp(url, { initData: a.initData });
      const second = await postWebapp(url, { initData: b.initData });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    } finally {
      close();
    }
  });
});
