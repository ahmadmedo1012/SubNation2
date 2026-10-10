import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletTopupsTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { walletRouter } from "../wallet";

/**
 * R123 (E1, test battery) + R128 (B8-D2, folded) — the outbound
 * Telegram operator card on POST /api/wallet/topups (routes/wallet.ts).
 *
 * R128 (B8-D2): the card is now notifyNewTopup itself — ONE card per
 * PENDING topup, carrying the ✅/❌ inline keyboard (the wallet route's
 * bespoke second card, with raw enums + a bespoke fetch bypassing the
 * telegram.ts metrics/retry pipeline, was deleted). The card is the
 * operator's money checkpoint: ROUNDED stored amount (AUD103-2-F6
 * display-vs-storage parity — approving 25.555 credits 25.56, shown as
 * the formatLyd grouped canon), mapped network names (PAYMENT_NETWORK_
 * LABELS — never raw enums), the canon «رمز التحويل» reference, and
 * the keyboard whose callback_data the /api/webhook/telegram money
 * path keys on (topup_app:<id> / topup_rej:<id> — R121). The INBOUND
 * half is pinned by telegram-webhook-topup-money-path.test.ts.
 *
 *   1. a pending submission dispatches EXACTLY ONE sendMessage — the
 *      folded card WITH the approve/reject keyboard;
 *   2. metacharacters in user-controlled fields are HTML-escaped
 *      (SEC-92-09 — a raw <b> in a user field used to break the whole
 *      sendMessage and silently drop the keyboard);
 *   3. auto-rejected submissions (serial-abuser heuristic) send NO
 *      card at all — a rejected request must never reach the approve
 *      buttons (R128: was “a keyboard-less notifyNewTopup still fires”;
 *      the folded card's «⏳ بانتظار الموافقة» + buttons would be false
 *      information for a row that is already rejected).
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

describe("R123 (E1) + R128 (B8-D2): the folded Telegram operator card on POST /api/wallet/topups", () => {
  it("a pending submission dispatches EXACTLY ONE card: HTML mode, ROUNDED stored amount, mapped network, canon reference, exact approve/reject callbacks", async () => {
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

      // ONE sendMessage TOTAL (B8-D2: the bespoke approval card AND the
      // business notification used to fire as two separate messages).
      expect(sendMessageBodies()).toHaveLength(1);
      const card = approvalCards()[0]!;
      expect(card.chat_id).toBe(CHAT_ID);
      expect(card.parse_mode).toBe("HTML");
      const text = String(card.text);
      // AUD103-2-F6: the operator sees the STORED amount (25.56) via the
      // formatLyd display canon — never the raw 25.555.
      expect(text).toContain("المبلغ: <b>25.56 د.ل</b>");
      expect(text).not.toContain("25.555");
      // A8 F1 / B8-D2: the human network name, never the raw enum.
      expect(text).toContain("الشبكة: مدار");
      expect(text).not.toContain("madar");
      expect(text).not.toContain("mobile_transfer");
      // B8 unification win #4: «رمز التحويل» — not «المرجع».
      expect(text).toContain("رمز التحويل: <code>TRX-CARD-1</code>");
      expect(text).not.toContain("المرجع");
      expect(text).toContain(`معرّف الطلب: <code>#${topupId}</code>`);
      expect(text).toContain("⏳ بانتظار الموافقة");
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
      // lypay: the receipt reference is free-form and rides the card
      // (R128: the folded card's one user-controlled field — the SEC-92-09
      // class stays covered). A raw <b>/& used to break Telegram's parser
      // and silently drop the whole approve/reject keyboard.
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
      // The escaped reference rides the card…
      expect(text).toContain("رمز التحويل: <code>TRX-&lt;&amp;&gt;</code>");
      // …and its raw metacharacters never do (the only <…> in the text
      // are the card's own markup tags).
      expect(text).not.toContain("TRX-<&>");
    } finally {
      close();
    }
  });

  it("an auto-rejected submission (serial-abuser heuristic) sends NO card at all (R128 B8-D2)", async () => {
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

      // R128 (B8-D2): the folded card says «⏳ بانتظار الموافقة» and
      // carries approve/reject buttons — for a row the heuristic ALREADY
      // rejected, that would be false information (and a dead button).
      // The row is honestly rejected with zero Telegram traffic; the
      // admin queue remains the operator surface for it.
      await new Promise((r) => setTimeout(r, 150));
      expect(sendMessageBodies()).toHaveLength(0);

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
