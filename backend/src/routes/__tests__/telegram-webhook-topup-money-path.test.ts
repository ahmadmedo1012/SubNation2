import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { telegramWebhookRouter } from "../telegram-webhook";

/**
 * R122 (A9-3): pinning the telegram topup money path — the chat-button
 * approve/reject wiring in POST /api/webhook/telegram
 * (routes/telegram-webhook.ts handleCallbackQuery + route handler).
 *
 * The two ENDS of this path are already covered: the pure parser
 * (parseTopupCallback) and the /start timeout guard live in
 * telegram-webhook.test.ts, and TopupService.approve/reject state-machine
 * + dedup guards live in services/__tests__/topup*.test.ts. What had ZERO
 * tests (A9 P1-1) is the WIRING between them — the segment real money
 * flows through in production since R121 brought the channel live:
 *
 *   1. secret-token gate  — missing/wrong x-telegram-bot-api-secret-token
 *      → 403; non-JSON probes → 200 ack without processing; secret unset
 *      → 503 (fail closed, never a silent accept);
 *   2. allowlist gate     — a from.id OUTSIDE TELEGRAM_ADMIN_IDS taps ✅
 *      on a PENDING topup → denial toast, zero DB mutation (any group
 *      member could otherwise move money);
 *   3. malformed callback — unknown action / missing data → clean
 *      no-op toast (parser contract pinned by the sibling suite);
 *   4. stale pre-check    — an already-processed topup → "already
 *      processed" toast + reply-keyboard strip, NO second credit;
 *   5. valid approve      — wallet credited EXACTLY ONCE (balance +
 *      one ledger row), actor attribution persisted (reviewed_by +
 *      admin_note carry the @username tag — A4-04), and a full callback
 *      REPLAY (Telegram retries deliveries) credits nothing again;
 *   6. valid reject       — no credit, honest rejected transition,
 *      tg:<id> actor tag when the tapper has no username;
 *   7. service failure    — a TopupService 409 (duplicate payment
 *      reference) surfaces as the failure toast, the webhook still acks
 *      200, and no double credit happens;
 *   8. always-200 policy  — an update that makes processing throw
 *      (malformed callback_query payload) is still acked 200
 *      {ok:true}: Telegram retries non-200s aggressively, so an internal
 *      error must never leak a 5xx.
 *
 * Harness: the REAL router over the pglite fixture DB with the REAL
 * TopupService (same mount-and-fetch idiom as auth-firebase-session.test.ts
 * / wallet-topups.test.ts); only the Telegram Bot API boundary is stubbed —
 * globalThis.fetch routes http://127.0.0.1 to the real server and captures
 * api.telegram.org calls (extension of the fetch-stub idiom in
 * telegram-webhook.test.ts). TELEGRAM_CHAT_ID stays unset so the
 * fire-and-forget notify* dispatches in src/telegram.ts self-skip.
 */

// ── Harness ─────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/webhook", telegramWebhookRouter);
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

/**
 * fetch splitter: the test client's http://127.0.0.1 requests go to the
 * real (local) server; every https://api.telegram.org call is captured
 * and answered with Telegram's success envelope.
 */
const ORIGINAL_FETCH = globalThis.fetch;
const botApiCalls: Array<{ method: string; body: Record<string, unknown> }> = [];

function botCalls(method: string): Array<Record<string, unknown>> {
  return botApiCalls.filter((c) => c.method === method).map((c) => c.body);
}

/** answerCallbackQuery bodies for one callback_query id, in order. */
function answersFor(callbackQueryId: string): Array<Record<string, unknown>> {
  return botCalls("answerCallbackQuery").filter((b) => b.callback_query_id === callbackQueryId);
}

const WEBHOOK_SECRET = "test-webhook-secret-value";
const BOT_TOKEN = "123456:TEST-TOKEN";
/** TELEGRAM_ADMIN_IDS allowlist: 111111 (has @username), 222222 (bare id). */
const ADMIN_WITH_USERNAME = 111111;
const ADMIN_BARE_ID = 222222;
const OUTSIDER_ID = 999_999;

async function postUpdate(
  url: string,
  update: unknown,
  opts: { secret?: string | null; contentType?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/webhook/telegram`, {
    method: "POST",
    headers: {
      "Content-Type": opts.contentType ?? "application/json",
      ...(opts.secret === null
        ? {}
        : { "x-telegram-bot-api-secret-token": opts.secret ?? WEBHOOK_SECRET }),
    },
    body: JSON.stringify(update),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A callback_query update for a topup action. */
function callbackUpdate(
  fromId: number,
  data: string | undefined,
  topupActionId: string,
  withMessageContext = true,
) {
  return {
    update_id: 1,
    callback_query: {
      id: topupActionId,
      from:
        fromId === ADMIN_WITH_USERNAME ? { id: fromId, username: "ops_manager" } : { id: fromId },
      message: withMessageContext
        ? {
            chat: { id: 777 },
            message_id: 55,
            text: "طلب شحن جديد — 25.00 د.ل",
          }
        : undefined,
      ...(data === undefined ? {} : { data }),
    },
  };
}

// ── Seeding (wallet-topups.test.ts deterministic-phone idiom) ────────────────

let phoneSeq = 91_500_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(balance = "0.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

type TopupStatus = "pending" | "approved" | "rejected";

async function seedTopup(
  userId: number,
  status: TopupStatus,
  overrides: { amount?: string; paymentReference?: string | null } = {},
) {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount: overrides.amount ?? "25.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status,
      ...(overrides.paymentReference === undefined
        ? {}
        : { paymentReference: overrides.paymentReference }),
    })
    .returning();
  return t;
}

async function balanceOf(userId: number): Promise<string> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return String(u!.walletBalance);
}

async function topupRow(topupId: number) {
  const [t] = await db.select().from(walletTopupsTable).where(eq(walletTopupsTable.id, topupId));
  return t!;
}

async function ledgerFor(userId: number) {
  return db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, userId));
}

// ── Env + fetch setup ────────────────────────────────────────────────────────

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ["TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_IDS"] as const;

beforeAll(async () => {
  await initTestDb();
  for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_ADMIN_IDS = `${ADMIN_WITH_USERNAME},${ADMIN_BARE_ID}`;

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

// ── 1) Secret-token + content-type gates ─────────────────────────────────────

describe("POST /api/webhook/telegram — security gates", () => {
  it("a request with NO secret header → 403, no processing, no Bot API calls", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(url, callbackUpdate(ADMIN_WITH_USERNAME, "topup_app:1", "cq1"), {
        secret: null,
      });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ ok: false });
      expect(botApiCalls).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("a WRONG secret → 403 (constant-time compare branch, same shape)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(url, callbackUpdate(ADMIN_WITH_USERNAME, "topup_app:1", "cq1"), {
        secret: "not-the-secret",
      });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ ok: false });
      expect(botApiCalls).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("TELEGRAM_WEBHOOK_SECRET unset → 503 (fail closed — never a silent accept)", async () => {
    const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      const { url, close } = await listen(buildApp());
      try {
        const res = await postUpdate(
          url,
          callbackUpdate(ADMIN_WITH_USERNAME, "topup_app:1", "cq1"),
        );
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ ok: false });
        expect(botApiCalls).toHaveLength(0);
      } finally {
        close();
      }
    } finally {
      process.env.TELEGRAM_WEBHOOK_SECRET = saved;
    }
  });

  it("a non-JSON content-type probe (setWebhook ping) → 200 ack WITHOUT processing", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(url, { update_id: 1 }, { contentType: "text/plain" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(botApiCalls).toHaveLength(0);
    } finally {
      close();
    }
  });
});

// ── 2) Allowlist gate — who may move money ───────────────────────────────────

describe("POST /api/webhook/telegram — TELEGRAM_ADMIN_IDS allowlist gate", () => {
  it("a non-allowlisted from.id tapping ✅ on a PENDING topup → denial toast, zero mutation", async () => {
    const user = await seedUser("10.00");
    const topup = await seedTopup(user.id, "pending");
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(OUTSIDER_ID, `topup_app:${topup.id}`, "cq-out"),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // The gate answers the tapper (alert, Arabic denial)…
      const answers = answersFor("cq-out");
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({
        text: "عذراً، لا تمتلك الصلاحية لتنفيذ هذا الإجراء.",
        show_alert: true,
      });
      // …but touches NOTHING: no keyboard strip, no editMessageText…
      expect(botCalls("editMessageReplyMarkup")).toHaveLength(0);
      expect(botCalls("editMessageText")).toHaveLength(0);
      // …and no money moved: still pending, balance intact, no ledger row,
      // no reviewer attribution.
      expect((await topupRow(topup.id)).status).toBe("pending");
      expect(await balanceOf(user.id)).toBe("10.00");
      expect(await ledgerFor(user.id)).toHaveLength(0);
      expect((await topupRow(topup.id)).reviewedBy).toBeNull();
    } finally {
      close();
    }
  });
});

// ── 3) Malformed callback data — clean no-op ────────────────────────────────

describe("POST /api/webhook/telegram — malformed callback data (allowlisted tapper)", () => {
  it.each([
    ["unknown action prefix", "topup_banana:3"],
    ["garbage payload", "give_me_money:5"],
  ])("%s → invalid-data toast, no mutation, no 5xx", async (_label, data) => {
    const user = await seedUser("10.00");
    const topup = await seedTopup(user.id, "pending");
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(url, callbackUpdate(ADMIN_WITH_USERNAME, data, "cq-bad"));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const answers = answersFor("cq-bad");
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ text: "بيانات غير صالحة", show_alert: true });
      expect(botCalls("editMessageReplyMarkup")).toHaveLength(0);
      expect((await topupRow(topup.id)).status).toBe("pending");
      expect(await balanceOf(user.id)).toBe("10.00");
    } finally {
      close();
    }
  });

  it("missing data entirely → same clean no-op", async () => {
    const user = await seedUser("10.00");
    await seedTopup(user.id, "pending");
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, undefined, "cq-nodata"),
      );
      expect(res.status).toBe(200);
      const answers = answersFor("cq-nodata");
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ text: "بيانات غير صالحة", show_alert: true });
      expect(await ledgerFor(user.id)).toHaveLength(0);
    } finally {
      close();
    }
  });
});

// ── 4) Stale pre-check — no double credit on an already-processed topup ─────

describe("POST /api/webhook/telegram — stale topup pre-check (no double credit)", () => {
  it("an ALREADY-APPROVED topup tapped ✅ again → already-processed toast + keyboard strip, balance unchanged", async () => {
    // The user was already credited by the first approval (balance 35.00).
    const user = await seedUser("35.00");
    const topup = await seedTopup(user.id, "approved");
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${topup.id}`, "cq-stale1"),
      );
      expect(res.status).toBe(200);

      const answers = answersFor("cq-stale1");
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({
        text: "تمت معالجة هذا الطلب مسبقاً",
        show_alert: true,
      });

      // The stale keyboard is stripped so the dead button can't be tapped
      // again (the one edit the stale branch performs)…
      const edits = botCalls("editMessageReplyMarkup");
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({ chat_id: 777, message_id: 55 });
      // …but no money moves and no text rewrite happens on this branch.
      expect(await balanceOf(user.id)).toBe("35.00");
      expect(await ledgerFor(user.id)).toHaveLength(0);
      expect(botCalls("editMessageText")).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("an ALREADY-REJECTED topup tapped ✅ → same already-processed toast, no credit", async () => {
    const user = await seedUser("10.00");
    const topup = await seedTopup(user.id, "rejected");
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${topup.id}`, "cq-stale2"),
      );
      expect(res.status).toBe(200);
      expect(answersFor("cq-stale2")[0]).toMatchObject({
        text: "تمت معالجة هذا الطلب مسبقاً",
        show_alert: true,
      });
      expect(await balanceOf(user.id)).toBe("10.00");
      expect(await ledgerFor(user.id)).toHaveLength(0);
      expect((await topupRow(topup.id)).status).toBe("rejected");
    } finally {
      close();
    }
  });

  it("a non-existent topup id → not-found toast, no credit, no edits", async () => {
    const user = await seedUser("10.00");
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, "topup_app:424242", "cq-missing"),
      );
      expect(res.status).toBe(200);
      expect(answersFor("cq-missing")[0]).toMatchObject({
        text: "الطلب غير موجود",
        show_alert: true,
      });
      expect(botCalls("editMessageReplyMarkup")).toHaveLength(0);
      expect(await balanceOf(user.id)).toBe("10.00");
    } finally {
      close();
    }
  });
});

// ── 5) Valid approve — the money path, credited exactly once ────────────────

describe("POST /api/webhook/telegram — valid approve (money path)", () => {
  it("credits the wallet EXACTLY ONCE with a ledger row, strips the keyboard, rewrites the card, and records the @username actor", async () => {
    const user = await seedUser("10.00");
    const topup = await seedTopup(user.id, "pending", { amount: "25.00" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${topup.id}`, "cq-ok"),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // Money: credited once, balance 10 + 25…
      expect(await balanceOf(user.id)).toBe("35.00");
      // …with EXACTLY ONE atomic ledger entry (Constitution Principle I).
      const ledger = await ledgerFor(user.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        type: "topup",
        amount: "25.00",
        balanceBefore: "10.00",
        balanceAfter: "35.00",
        referenceId: topup.id,
        referenceType: "wallet_topup",
      });

      // State + actor attribution (A4-04): the tapping operator rides
      // reviewed_by AND the admin note.
      const row = await topupRow(topup.id);
      expect(row.status).toBe("approved");
      expect(row.reviewedBy).toBe("@ops_manager");
      expect(row.adminNote).toBe("موافقة عبر تليقرام بواسطة @ops_manager");
      expect(row.reviewedAt).not.toBeNull();

      // Card UX: keyboard stripped, original text extended with the
      // approval line, tapper answered (no alert).
      const markupEdits = botCalls("editMessageReplyMarkup");
      expect(markupEdits).toHaveLength(1);
      expect(markupEdits[0]).toMatchObject({ chat_id: 777, message_id: 55 });
      const textEdits = botCalls("editMessageText");
      expect(textEdits).toHaveLength(1);
      expect(textEdits[0]).toMatchObject({
        chat_id: 777,
        message_id: 55,
        text: "طلب شحن جديد — 25.00 د.ل\n\n✅ الحالة: تمت الموافقة بواسطة @ops_manager",
      });
      const answers = answersFor("cq-ok");
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ text: "✅ تمت الموافقة وإضافة الرصيد" });
      // The gateway always serializes show_alert when text is present —
      // false here: the success verdict is a quiet toast, not an alert.
      expect(answers[0]).toMatchObject({ show_alert: false });
    } finally {
      close();
    }
  });

  it("a full callback REPLAY (Telegram redelivers the update) credits NOTHING again", async () => {
    const user = await seedUser("10.00");
    const topup = await seedTopup(user.id, "pending", { amount: "25.00" });
    const { url, close } = await listen(buildApp());
    try {
      // First delivery — the real approval.
      const first = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${topup.id}`, "cq-replay"),
      );
      expect(first.status).toBe(200);
      expect(await balanceOf(user.id)).toBe("35.00");

      // Telegram retries the SAME update (same callback_query id, same
      // data). The webhook must ack it — and credit nothing again.
      const replay = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${topup.id}`, "cq-replay"),
      );
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ ok: true });

      // No double credit: balance, ledger and status are exactly the
      // post-first-approval truth, and the replay gets the honest
      // already-processed toast.
      expect(await balanceOf(user.id)).toBe("35.00");
      const ledger = await ledgerFor(user.id);
      expect(ledger).toHaveLength(1);
      expect((await topupRow(topup.id)).status).toBe("approved");
      const answers = answersFor("cq-replay");
      expect(answers).toHaveLength(2);
      expect(answers[1]).toMatchObject({
        text: "تمت معالجة هذا الطلب مسبقاً",
        show_alert: true,
      });
    } finally {
      close();
    }
  });
});

// ── 6) Valid reject — honest transition, no credit ──────────────────────────

describe("POST /api/webhook/telegram — valid reject (money path)", () => {
  it("rejects without crediting, records the tg:<id> actor when the tapper has no username", async () => {
    const user = await seedUser("10.00");
    const topup = await seedTopup(user.id, "pending", { amount: "25.00" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(
        url,
        callbackUpdate(ADMIN_BARE_ID, `topup_rej:${topup.id}`, "cq-rej"),
      );
      expect(res.status).toBe(200);

      // No credit of any kind: balance untouched, ZERO ledger rows.
      expect(await balanceOf(user.id)).toBe("10.00");
      expect(await ledgerFor(user.id)).toHaveLength(0);

      // Honest state transition + actor attribution (bare-id tag shape).
      const row = await topupRow(topup.id);
      expect(row.status).toBe("rejected");
      expect(row.reviewedBy).toBe(`tg:${ADMIN_BARE_ID}`);
      expect(row.adminNote).toBe(`رفض عبر تليقرام بواسطة tg:${ADMIN_BARE_ID}`);
      expect(row.reviewedAt).not.toBeNull();

      // The card reflects the rejection + the tapper is answered.
      const textEdits = botCalls("editMessageText");
      expect(textEdits).toHaveLength(1);
      expect(String(textEdits[0]!.text)).toContain(
        `❌ الحالة: تم الرفض بواسطة tg:${ADMIN_BARE_ID}`,
      );
      const answers = answersFor("cq-rej");
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ text: "❌ تم رفض الطلب" });
    } finally {
      close();
    }
  });
});

// ── 7) Service failure — honest toast, still no 5xx ─────────────────────────

describe("POST /api/webhook/telegram — TopupService failure inside the money path", () => {
  it("a duplicate payment-reference 409 (the same transfer submitted twice) → failure toast, 200 ack, NO second credit", async () => {
    // Two pending topups backed by ONE real bank transfer (same receipt
    // reference) — the operator group gets one approval card per
    // submission (B2-02). Approving the first credits; approving the
    // second must be refused by the service's dedup battery.
    const user = await seedUser("0.00");
    const first = await seedTopup(user.id, "pending", {
      amount: "20.00",
      paymentReference: "TRX-WEBHOOK-DUP-1",
    });
    const second = await seedTopup(user.id, "pending", {
      amount: "20.00",
      paymentReference: "TRX-WEBHOOK-DUP-1",
    });

    const { url, close } = await listen(buildApp());
    try {
      const ok = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${first.id}`, "cq-dup-ok"),
      );
      expect(ok.status).toBe(200);
      expect(await balanceOf(user.id)).toBe("20.00");

      // The second card: the route's own pre-check passes (still
      // pending), the SERVICE refuses (409 duplicate reference) — the
      // webhook surfaces the failure toast and acks 200, never a 5xx.
      const refused = await postUpdate(
        url,
        callbackUpdate(ADMIN_WITH_USERNAME, `topup_app:${second.id}`, "cq-dup-refused"),
      );
      expect(refused.status).toBe(200);
      expect(refused.body).toEqual({ ok: true });
      expect(answersFor("cq-dup-refused")[0]).toMatchObject({
        text: "فشل تنفيذ الإجراء، حاول مجدداً",
        show_alert: true,
      });

      // Exactly one credit for one real transfer.
      expect(await balanceOf(user.id)).toBe("20.00");
      const ledger = await ledgerFor(user.id);
      expect(ledger).toHaveLength(1);
      expect((await topupRow(second.id)).status).toBe("pending");
    } finally {
      close();
    }
  });
});

// ── 8) Always-200 policy ────────────────────────────────────────────────────

describe("POST /api/webhook/telegram — always-200 ack policy", () => {
  it("an update that makes processing THROW (malformed callback_query payload) is still acked 200, never a 500", async () => {
    const { url, close } = await listen(buildApp());
    try {
      // A truthy but non-object callback_query: the handler dereferences
      // cq.from.id → TypeError → the route's catch-all. Telegram retries
      // non-200s aggressively, so internal errors must not leak a 5xx —
      // the ack also stops the retry loop.
      const res = await postUpdate(url, { update_id: 9, callback_query: "garbage" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    } finally {
      close();
    }
  });

  it("a plain non-/start message is acked 200 with no Bot API traffic", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUpdate(url, {
        update_id: 10,
        message: { chat: { id: 777, type: "private" }, from: { id: 111111 }, text: "hello" },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(botApiCalls).toHaveLength(0);
    } finally {
      close();
    }
  });
});
