import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, userAuthIdentitiesTable, usersTable } from "../../test/db";
import { signTelegramWebAppFixture } from "../../lib/telegram-auth";
import { __test as replayTestHooks } from "../../lib/telegram-replay";
import { handleTelegramWebAppAuth } from "../telegram-auth-flow";

/**
 * R146 audit F3 — Telegram first-login double-submit race (WhatsApp F6
 * parity, mirrored idiom from whatsapp-otp-consume-race.test.ts).
 *
 * Two DIFFERENT-but-valid initData payloads (two devices) racing the FIRST
 * login for one Telegram id: both pass verification, both pass their own
 * replay-hash claim (different hashes), both miss the find-or-create
 * SELECT, and both INSERT — the loser tripped users.telegram_id / phone
 * UNIQUE as an unclassified 23505 → raw 500 for a registration that
 * actually succeeded. Secondary effect: the loser's replay hash was
 * claimed BEFORE find-or-create, so the failed attempt left it stranded
 * ("replay detected" on the honest retry until the TTL).
 *
 * Fix under test: the INSERT's 23505 is caught, the winner's row is
 * re-read by telegram_id and returned as a NORMAL login — the loser mints
 * its own session, no throw, no stranded claim.
 *
 * Race simulation: the first plain `db.select` (findOrCreateTelegramUser's
 * telegram_id lookup) delivers its rows only AFTER the "concurrent
 * winner's" INSERT commits on the session — the exact read→write window.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle builder
   internals are intentionally opaque (same caveat as the F6 test this
   mirrors). */

const BOT_TOKEN = "1234567890:AAH-test-bot-token-not-real-do-not-reuse";

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

/** findOrCreateTelegramUser's lookup is an unprojected `db.select()`. */
function isTelegramIdSelect(fields: unknown): boolean {
  return fields === undefined;
}

let tgSeq = 600_000_000;

beforeAll(async () => {
  await initTestDb();
  // Tables the shared harness DDL does not carry (same blocks as
  // telegram-referral-gate.test.ts, mirroring the real schema).
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
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw(`DELETE FROM user_auth_identities;`));
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({ enabled: true, bot_token: BOT_TOKEN })})`,
  );
  // Isolate the in-memory replay store (no-Redis production shape).
  replayTestHooks.resetMemoryStore();
});

describe("R146 F3 — Telegram first-login double-submit returns the winner's row", () => {
  it("loser of the users-INSERT race gets a normal login on the winner's row (no 23505 → 500, no stranded hash)", async () => {
    tgSeq += 1;
    const tgId = String(tgSeq);
    const initData = signTelegramWebAppFixture(
      {
        user: { id: tgId, first_name: "Race", username: `race_${tgId}` },
        auth_date: Math.floor(Date.now() / 1000),
      },
      BOT_TOKEN,
    );

    // The "other device": its request commits the user INSERT right after
    // our SELECT read the (still empty) table — the loser's INSERT then
    // collides on users.telegram_id UNIQUE.
    const restore = interleaveAfterDbSelect(isTelegramIdSelect, async () => {
      await db.execute(
        sql`INSERT INTO users (phone, telegram_id, auth_provider) VALUES (${"tg_" + tgId}, ${tgId}, 'telegram')`,
      );
    });

    let result: Awaited<ReturnType<typeof handleTelegramWebAppAuth>>;
    try {
      result = await handleTelegramWebAppAuth(initData, undefined, {
        ipAddress: "127.0.0.1",
        userAgent: "vitest/1.0",
      });
    } finally {
      restore();
    }

    // A normal login on the winner's row — NOT the raw 23505 throw the
    // route used to 500 on.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.isNewUser).toBe(false);

    // Exactly ONE user for the Telegram id — the winner's row.
    const rows = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId));
    expect(rows).toHaveLength(1);

    // The loser's login refreshed the identity row (the existing-user
    // branch's last_seen_at contract).
    const identities = await db
      .select()
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.providerUid, tgId));
    expect(identities).toHaveLength(1);
    expect(identities[0]!.provider).toBe("telegram.org");
  });
});
