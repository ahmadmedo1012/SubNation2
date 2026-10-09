import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletTopupsTable,
} from "../../test/db";
import { telegramWebhookRouter } from "../telegram-webhook";

/**
 * R127-L5 (B11-F1) — pinning the audit row the Telegram money path
 * lacked: POST /api/webhook/telegram's approve/reject callbacks credit
 * wallets, but `writeAuditLog` appeared ZERO times in the webhook
 * (B11 §2.2) — a Telegram-tapped approval moved money with no
 * audit_logs row, while the admin-UI path wrote one
 * (admin/topups.ts:159/196). This suite pins the fix:
 *
 *   1. approve → a topup.approve audit row: targetType/targetId = the
 *      topup, actorType "admin", actorId NULL (the tapper is a
 *      TELEGRAM_ADMIN_IDS entry, not necessarily a console admin), and
 *      the metadata triple { source: "telegram_webhook", actor:
 *      "@username" | "tg:<id>", from_id } — the B11-F1 fix directive
 *      verbatim.
 *   2. reject → the symmetric topup.reject row (tg:<id> actor arm).
 *   3. the NO-ROW arms: an allowlist-denied tap and an
 *      already-processed topup never write audit rows (only
 *      successfully executed decisions are audited).
 *
 * Harness: same as telegram-webhook-topup-money-path.test.ts — the
 * REAL router over the pglite fixture DB with the REAL TopupService;
 * only the Telegram Bot API boundary is stubbed. The audit write is
 * fire-and-forget (the writeAuditLog idiom), so the assertions poll
 * the table briefly instead of assuming request/response ordering.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/webhook", telegramWebhookRouter);
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
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

const ORIGINAL_FETCH = globalThis.fetch;
const WEBHOOK_SECRET = "test-webhook-secret-value";
const BOT_TOKEN = "123456:TEST-TOKEN";
/** TELEGRAM_ADMIN_IDS allowlist: 111111 (@ops_manager), 222222 (bare). */
const ADMIN_WITH_USERNAME = 111111;
const ADMIN_BARE_ID = 222222;
const OUTSIDER_ID = 999_999;

async function postUpdate(
  url: string,
  update: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}/api/webhook/telegram`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function callbackUpdate(fromId: number, data: string, callbackQueryId: string) {
  return {
    update_id: 1,
    callback_query: {
      id: callbackQueryId,
      from:
        fromId === ADMIN_WITH_USERNAME ? { id: fromId, username: "ops_manager" } : { id: fromId },
      message: { chat: { id: 777 }, message_id: 55, text: "طلب شحن جديد — 25.00 د.ل" },
      data,
    },
  };
}

let phoneSeq = 91_600_000;
async function seedUser() {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: "0.00" })
    .returning();
  return u;
}

async function seedTopup(userId: number, status: "pending" | "approved" | "rejected") {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount: "25.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status,
    })
    .returning();
  return t;
}

/** All audit rows for one topup (the write is fire-and-forget — poll). */
async function auditRowsFor(topupId: number, tries = 20): Promise<Array<Record<string, unknown>>> {
  for (let i = 0; i < tries; i += 1) {
    const rows = await db.select().from(auditLogsTable).where(eq(auditLogsTable.targetId, topupId));
    if (rows.length > 0) return rows as Array<Record<string, unknown>>;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ["TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_IDS"] as const;

beforeAll(async () => {
  await initTestDb();
  for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_ADMIN_IDS = `${ADMIN_WITH_USERNAME},${ADMIN_BARE_ID}`;

  // Same Bot API splitter as the money-path suite: api.telegram.org is
  // captured + answered with Telegram's success envelope.
  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.telegram.org/")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return ORIGINAL_FETCH(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key];
  }
});

beforeEach(async () => {
  await resetTestDb();
});

describe("B11-F1 — the Telegram money path writes its audit row", () => {
  it("an approve taps → ONE topup.approve row with the B11-F1 directive shape", async () => {
    const user = await seedUser();
    const topup = await seedTopup(user.id, "pending");
    const { url, close } = await listen();
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${topup.id}`, "cq-app"),
      );
      expect(res.status).toBe(200);

      const rows = await auditRowsFor(topup.id);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      // Same action classes as the admin-UI path (admin/topups.ts:159).
      expect(row.action).toBe("topup.approve");
      expect(row.targetType).toBe("topup");
      expect(row.targetId).toBe(topup.id);
      // The tapper is allowlisted in TELEGRAM_ADMIN_IDS, not a console
      // admin session — attribution lives in metadata, actorId is null.
      expect(row.actorType).toBe("admin");
      expect(row.actorId).toBeNull();
      expect(JSON.parse(String(row.metadata))).toEqual({
        source: "telegram_webhook",
        actor: "@ops_manager",
        from_id: ADMIN_WITH_USERNAME,
      });
      // "ip if available" — the webhook delivery request's IP.
      expect(typeof row.ip).toBe("string");
      expect(row.ip).not.toBe("");
    } finally {
      close();
    }
  });

  it("a reject by a username-less admin → the tg:<id> actor arm + topup.reject", async () => {
    const user = await seedUser();
    const topup = await seedTopup(user.id, "pending");
    const { url, close } = await listen();
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_BARE_ID, `topup_rej:${topup.id}`, "cq-rej"),
      );
      expect(res.status).toBe(200);

      const rows = await auditRowsFor(topup.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("topup.reject");
      expect(JSON.parse(String(rows[0].metadata))).toEqual({
        source: "telegram_webhook",
        actor: `tg:${ADMIN_BARE_ID}`,
        from_id: ADMIN_BARE_ID,
      });
    } finally {
      close();
    }
  });

  it("an allowlist-DENIED tap and an already-processed topup write NO audit rows", async () => {
    const deniedUser = await seedUser();
    const deniedTopup = await seedTopup(deniedUser.id, "pending");
    const staleUser = await seedUser();
    const staleTopup = await seedTopup(staleUser.id, "approved");

    const { url, close } = await listen();
    try {
      const denied = await postUpdate(
        url,
        callbackUpdate(OUTSIDER_ID, `topup_app:${deniedTopup.id}`, "cq-out"),
      );
      expect(denied.status).toBe(200);

      const stale = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${staleTopup.id}`, "cq-stale"),
      );
      expect(stale.status).toBe(200);

      // Neither path executed a decision — no audit rows (give the
      // fire-and-forget writer a beat to (not) land).
      await new Promise((r) => setTimeout(r, 100));
      const deniedRows = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.targetId, deniedTopup.id));
      const staleRows = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.targetId, staleTopup.id));
      expect(deniedRows).toHaveLength(0);
      expect(staleRows).toHaveLength(0);
    } finally {
      close();
    }
  });
});
