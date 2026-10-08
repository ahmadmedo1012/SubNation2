import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletTopupsTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { walletRouter } from "../wallet";

/**
 * R123 (E1, test battery) — the outbound Telegram APPROVAL CARD on
 * POST /api/wallet/topups (routes/wallet.ts, the `initialStatus ===
 * "pending"` fire-and-forget block).
 *
 * The card is the operator's money checkpoint: it carries the ROUNDED
 * stored amount (AUD103-2-F6 display-vs-storage parity — approving
 * 25.555 credits 25.56) and the inline keyboard whose callback_data
 * the /api/webhook/telegram money path keys on (topup_app:<id> /
 * topup_rej:<id> — R121). The INBOUND half (webhook approve/reject) is
 * pinned by telegram-webhook-topup-money-path.test.ts; this suite pins
 * the OUTBOUND half, which had zero coverage:
 *
 *   1. a pending submission dispatches EXACTLY ONE approval card —
 *      parse_mode HTML, rounded stored amount, exact callback buttons;
 *   2. metacharacters in user-controlled fields are HTML-escaped
 *      (SEC-92-09 — a raw <b> in a lypay sender field used to break the
 *      whole sendMessage and silently drop the keyboard);
 *   3. auto-rejected submissions (serial-abuser heuristic) send NO
 *      card — a rejected request must never reach the approve buttons.
 *
 * Harness: fetch-splitter idiom from telegram-webhook-topup-money-path
 * .test.ts — http://127.0.0.1 goes to the real server; every
 * https://api.telegram.org call is captured and answered with
 * Telegram's success envelope. With TELEGRAM_BOT_TOKEN +
 * TELEGRAM_CHAT_ID both set, the telegram.ts business notifications
 * (notifyNewTopup) also dispatch — they are keyboard-less and are
 * filtered out; THE card is identified by its topup_app/topup_rej
 * inline keyboard.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/wallet", walletRouter);
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

const ORIGINAL_FETCH = globalThis.fetch;
const botApiCalls: Array<{ method: string; body: Record<string, unknown> }> = [];

function sendMessageBodies(): Array<Record<string, unknown>> {
  return botApiCalls.filter((c) => c.method === "sendMessage").map((c) => c.body);
}

/** The approval card = the sendMessage carrying the topup_app/topup_rej keyboard. */
function approvalCards(): Array<Record<string, unknown>> {
  return sendMessageBodies().filter((b) => {
    const markup = b.reply_markup as { inline_keyboard?: unknown } | undefined;
    return !!markup && Array.isArray(markup.inline_keyboard);
  });
}

const BOT_TOKEN = "123456:TEST-TOKEN";
const CHAT_ID = "-1001234567890";

let phoneSeq = 91_900_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser() {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "0.00" })
    .returning();
  return u;
}

type TopupStatus = "pending" | "approved" | "rejected";

async function seedTopup(userId: number, status: TopupStatus) {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount: "20.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status,
    })
    .returning();
  return t;
}

async function postTopup(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/wallet/topups`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

beforeAll(async () => {
  await initTestDb();
  for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT_ID;

  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.telegram.org/")) {
      const method = url.split("/").pop() ?? "";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      botApiCalls.push({ method, body });
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
  botApiCalls.length = 0;
});

describe("R123 (E1): the Telegram approval card on POST /api/wallet/topups", () => {
  it("a pending submission dispatches EXACTLY ONE card: HTML mode, ROUNDED stored amount, exact approve/reject callbacks", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postTopup(url, token, {
        amount: 25.555, // raw submission — numeric(10,2) stores/credits 25.56
        payment_network: "madar",
        payment_reference: "TRX-CARD-1",
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "pending", amount: 25.56 });
      const topupId = res.body.id as number;

      // Fire-and-forget: the card lands shortly AFTER the 201.
      await vi.waitFor(() => {
        expect(approvalCards()).toHaveLength(1);
      });

      const card = approvalCards()[0]!;
      // One card, one card only — a duplicate would mean two keyboards
      // (two approvable buttons) for one transfer.
      expect(approvalCards()).toHaveLength(1);
      expect(card.chat_id).toBe(CHAT_ID);
      expect(card.parse_mode).toBe("HTML");
      // AUD103-2-F6: the operator sees the STORED amount (25.56) — the
      // value approval will actually credit — never the raw 25.555.
      expect(String(card.text)).toContain("25.56 د.ل");
      expect(String(card.text)).not.toContain("25.555");
      expect(String(card.text)).toContain(`طلب شحن جديد #${topupId}`);
      // The webhook money path keys on these exact callback_data values.
      expect(card.reply_markup).toEqual({
        inline_keyboard: [
          [
            { text: "✅ موافقة", callback_data: `topup_app:${topupId}` },
            { text: "❌ رفض", callback_data: `topup_rej:${topupId}` },
          ],
        ],
      });
    } finally {
      close();
    }
  });

  it("metacharacters in user-controlled fields are HTML-escaped (SEC-92-09)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const { url, close } = await listen(buildApp());
    try {
      // lypay: sender_phone is NOT normalized to digits (only length-
      // bounded, B2-F2), and the receipt reference is free-form — both
      // ride the card. A raw <b>/& used to break Telegram's parser and
      // silently drop the whole approve/reject keyboard.
      const res = await postTopup(url, token, {
        amount: 20,
        payment_method: "lypay",
        sender_account: "act-1",
        sender_phone: "<b>&x",
        payment_reference: "TRX-<&>",
      });
      expect(res.status).toBe(201);

      await vi.waitFor(() => {
        expect(approvalCards()).toHaveLength(1);
      });
      const text = String(approvalCards()[0]!.text);
      // Escaped forms present…
      expect(text).toContain("&lt;b&gt;");
      expect(text).toContain("&amp;");
      // …raw metacharacters from the user fields absent (the only <…>
      // in the text are the card's own markup tags).
      expect(text).not.toContain("<b>&x");
      expect(text).not.toContain("TRX-<&>");
    } finally {
      close();
    }
  });

  it("an auto-rejected submission (serial-abuser heuristic) sends NO card", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    // 3 prior rejections arm the auto-reject heuristic (rejectedCount >= 3)
    // — rejected rows do NOT count toward the pending cap.
    await seedTopup(user.id, "rejected");
    await seedTopup(user.id, "rejected");
    await seedTopup(user.id, "rejected");

    const { url, close } = await listen(buildApp());
    try {
      const res = await postTopup(url, token, {
        amount: 20,
        payment_network: "madar",
        payment_reference: "TRX-AUTOREJ",
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "rejected" });

      // The keyboard-less business notification (notifyNewTopup) still
      // fires — wait for it as proof the post-insert pipeline ran past
      // the card block, then assert no card was ever dispatched.
      await vi.waitFor(() => {
        expect(sendMessageBodies().length).toBeGreaterThanOrEqual(1);
      });
      expect(approvalCards()).toHaveLength(0);

      // And the row is honestly rejected (no operator decision needed).
      const [row] = await db
        .select()
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.userId, user.id));
      expect(row.status).toBe("rejected");
    } finally {
      close();
    }
  });
});
