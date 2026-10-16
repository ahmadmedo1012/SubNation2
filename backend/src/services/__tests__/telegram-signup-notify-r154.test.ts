import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable } from "../../test/db";
import { signTelegramWebAppFixture } from "../../lib/telegram-auth";
import { __test as replayTestHooks } from "../../lib/telegram-replay";
import { handleTelegramWebAppAuth } from "../telegram-auth-flow";

/**
 * R154 (P3-A/P3-B) — the exactly-once, provider-aware new-account
 * notification for the Telegram channel.
 *
 * The webhook: findOrCreateTelegramUser fires notifyNewUser ONLY on the
 * committed creation path — a normal login (second call) sends nothing,
 * and the operator card carries the VERIFIED identity (name, @username,
 * classic id) while the tg_<id> phone placeholder is NEVER presented as a
 * customer number («لم يقدّم رقم هاتف») and the absent email claim is said
 * to be absent («غير متاح من تيليجرام») instead of being fabricated.
 *
 * The card also deep-links to /admin/users?search=<id> (the directory's
 * prefill contract), and the username persists to users.telegram_username.
 */

const BOT_TOKEN = "1234567890:AAH-notify-test-token";
const CHAT_ID = "-1001234567890";

const ORIGINAL_FETCH = globalThis.fetch;
const sentMessages: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  await initTestDb();
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
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS auth_activity (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  identifier varchar(255) NOT NULL,
  action varchar(50) NOT NULL,
  provider varchar(50) NOT NULL,
  success boolean NOT NULL DEFAULT false,
  failure_reason text,
  ip_address varchar(45),
  user_agent varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
)`),
  );

  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT_ID;
  process.env.APP_URL = "https://subnation.ly";

  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.telegram.org/") && url.endsWith("/sendMessage")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      sentMessages.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return ORIGINAL_FETCH(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.APP_URL;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw(`DELETE FROM user_auth_identities;`));
  await db.execute(sql.raw(`DELETE FROM system_settings;`));
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({ enabled: true, bot_token: BOT_TOKEN })})`,
  );
  replayTestHooks.resetMemoryStore();
  sentMessages.length = 0;
});

describe("R154 — Telegram signup: exactly-once provider-aware new-account card", () => {
  it("a FIRST login dispatches ONE user_new card with verified identity + honest absent fields", async () => {
    const tgId = "700111222";
    const initData = signTelegramWebAppFixture(
      {
        user: {
          id: tgId,
          first_name: "محمد",
          last_name: "التاجوري",
          username: "mohamed_tajouri",
        },
        auth_date: Math.floor(Date.now() / 1000),
      },
      BOT_TOKEN,
    );

    const result = await handleTelegramWebAppAuth(initData, undefined, {
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNewUser).toBe(true);

    await vi.waitFor(() => {
      expect(sentMessages).toHaveLength(1);
    });
    const card = sentMessages[0]!;
    const text = String(card.text);
    // Provider line.
    expect(text).toContain("طريقة التسجيل: <b>تيليجرام</b>");
    // Verified identity claims.
    expect(text).toContain("الاسم: <b>محمد التاجوري</b>");
    expect(text).toContain("تيليجرام: <b>@mohamed_tajouri</b>");
    expect(text).toContain(`معرّف تيليجرام: <code>${tgId}</code>`);
    // The tg_ placeholder is NEVER presented as a phone number.
    expect(text).toContain("الهاتف: <b>لم يقدّم رقم هاتف</b>");
    expect(text).not.toContain(`tg_${tgId}`);
    // No email claim exists in the profile scope — said so, not fabricated.
    expect(text).toContain("البريد: <b>غير متاح من تيليجرام</b>");
    // Internal id + the deep link to the directory row.
    const [row] = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId));
    expect(text).toContain(`معرّف المستخدم: <code>#${row.id}</code>`);
    expect(JSON.stringify(card.reply_markup)).toContain(`/admin/users?search=${row.id}`);
    // The username persisted.
    expect(row.telegramUsername).toBe("mohamed_tajouri");
  });

  it("a SECOND login (same Telegram id) sends NO card — exactly-once", async () => {
    const tgId = "700333444";
    const now = Math.floor(Date.now() / 1000);
    // Two FRESH payloads (different auth_date → different replay hash) —
    // the same initData string would be (correctly) rejected as a replay.
    const initDataA = signTelegramWebAppFixture(
      { user: { id: tgId, first_name: "علي", username: "ali_second" }, auth_date: now },
      BOT_TOKEN,
    );
    const initDataB = signTelegramWebAppFixture(
      { user: { id: tgId, first_name: "علي", username: "ali_second" }, auth_date: now + 1 },
      BOT_TOKEN,
    );

    const first = await handleTelegramWebAppAuth(initDataA, undefined, {
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(first.ok).toBe(true);
    await vi.waitFor(() => {
      expect(sentMessages).toHaveLength(1);
    });

    // Normal login — no new card, no duplicate user.
    const second = await handleTelegramWebAppAuth(initDataB, undefined, {
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.isNewUser).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(sentMessages).toHaveLength(1);
    const rows = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId));
    expect(rows).toHaveLength(1);
  });

  it("a username CHANGE on an existing account refreshes users.telegram_username", async () => {
    const tgId = "700555666";
    const now = Math.floor(Date.now() / 1000);
    const firstLogin = signTelegramWebAppFixture(
      { user: { id: tgId, first_name: "سالم", username: "old_handle" }, auth_date: now },
      BOT_TOKEN,
    );
    await handleTelegramWebAppAuth(firstLogin, undefined, {
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    await vi.waitFor(() => {
      expect(sentMessages).toHaveLength(1);
    });

    const renamedLogin = signTelegramWebAppFixture(
      { user: { id: tgId, first_name: "سالم", username: "new_handle" }, auth_date: now + 1 },
      BOT_TOKEN,
    );
    await handleTelegramWebAppAuth(renamedLogin, undefined, {
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    const [row] = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId));
    expect(row.telegramUsername).toBe("new_handle");
    // Still one account, still one card.
    expect(sentMessages).toHaveLength(1);
  });
});
