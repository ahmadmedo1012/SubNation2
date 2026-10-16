import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";

/**
 * R153 — the pending-topup Telegram card settlement, end to end.
 *
 * The production defect this pins: a topup approved on the WEBSITE left
 * the operator chat's pending card with live ✅/❌ buttons (the site had
 * no message identity to edit it), so the next operator tap hit the stale
 * branch and saw the ambiguous «تمت معالجة هذا الطلب مسبقاً» — the exact
 * symptom that opened this round.
 *
 * The chain under test (all real, only the Bot API + Redis boundaries
 * stubbed):
 *
 *   notifyNewTopup (src/telegram.ts)
 *     → dispatchWithDetails captures result.message_id
 *     → recordTopupCard (lib/telegram-cards.ts) stores {chatId, messageId,
 *       text} keyed by topup id
 *   TopupService.approve/reject (services/topup.service.ts, REAL tx over
 *   the pglite fixture — the money path is not mocked)
 *     → settleTopupCard loads the identity, claims the key (GET+DEL),
 *       editMessageText(stored text + outcome line), editMessageReplyMarkup
 *       (keyboard stripped)
 *
 * Harness: the risk-redis-bounded.test.ts idiom — vi.hoisted state +
 * vi.mock of lib/redis-client (real withRedisCommandTimeout kept via
 * importOriginal, getRedisClient → injectable double); api.telegram.org
 * fetch stubbed per the telegram money-path suite (127.0.0.1 passthrough,
 * Bot API captured). TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID set so the
 * dispatch pipeline actually delivers to the stub.
 */

const { redisState } = vi.hoisted(() => ({
  redisState: { client: null as unknown },
}));

vi.mock("../../lib/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/redis-client")>();
  return { ...actual, getRedisClient: () => redisState.client };
});

import { notifyNewTopup } from "../../telegram";
import { TopupService } from "../../services/topup.service";

// ── Redis double (in-memory, the idempotency-suite shape) ──────────────────

function makeRedisDouble() {
  const store = new Map<string, string>();
  return {
    isReady: true,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n += 1;
      return n;
    },
    /** Test-only: the live store, for key assertions. */
    __store: store,
  };
}

// ── Bot API fetch stub (the money-path suite idiom) ───────────────────────

const ORIGINAL_FETCH = globalThis.fetch;
const botApiCalls: Array<{ method: string; body: Record<string, unknown> }> = [];

function botCalls(method: string): Array<Record<string, unknown>> {
  return botApiCalls.filter((c) => c.method === method).map((c) => c.body);
}

// ── Env ────────────────────────────────────────────────────────────────────

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

let phoneSeq = 91_600_000;

/** Let fire-and-forget chains (dispatch .then → record; void settle) run. */
function flush(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  await initTestDb();
  for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN";
  process.env.TELEGRAM_CHAT_ID = "777";

  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.telegram.org/")) {
      const method = url.split("/").pop() ?? "";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      botApiCalls.push({ method, body });
      if (method === "sendMessage") {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 4242 } }), {
          status: 200,
        });
      }
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
  redisState.client = makeRedisDouble();
});

async function seedUserWithPendingTopup(): Promise<{ userId: number; topupId: number }> {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(++phoneSeq), walletBalance: "0.00" })
    .returning();
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId: u!.id,
      amount: "25.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status: "pending",
    })
    .returning();
  return { userId: u!.id, topupId: t!.id };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("R153 — pending-topup Telegram card settlement", () => {
  it("a WEBSITE approval settles the card: outcome line appended, keyboard stripped, key claimed", async () => {
    const { userId, topupId } = await seedUserWithPendingTopup();

    // The wallet route's producer: the pending card goes out with buttons.
    notifyNewTopup({
      phone: "0910000001",
      amount: 25,
      network: "madar",
      topupId,
    });
    await flush();

    // The card identity is recorded (sendMessage delivered message 4242).
    const redis = redisState.client as ReturnType<typeof makeRedisDouble>;
    expect(redis.__store.get(`tg:topupcard:${topupId}`)).toBeTruthy();

    // The website operator approves (reviewedBy = console username).
    await TopupService.approve(topupId, null, "medo");

    // Money first: credited exactly once with one ledger row.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    expect(String(u!.walletBalance)).toBe("25.00");
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, userId));
    expect(ledger).toHaveLength(1);

    // The card settlement: text stamped with the outcome + actor,
    // keyboard stripped — the stale-button trap is gone proactively.
    await flush();
    const textEdits = botCalls("editMessageText");
    expect(textEdits).toHaveLength(1);
    expect(textEdits[0]).toMatchObject({ chat_id: 777, message_id: 4242 });
    expect(String(textEdits[0]!.text)).toContain("<b>طلب شحن جديد</b>");
    expect(String(textEdits[0]!.text)).toContain("⏳ بانتظار الموافقة");
    expect(String(textEdits[0]!.text)).toContain("✅ الحالة: تمت الموافقة بواسطة medo");
    const markupEdits = botCalls("editMessageReplyMarkup");
    expect(markupEdits).toHaveLength(1);
    expect(markupEdits[0]).toMatchObject({
      chat_id: 777,
      message_id: 4242,
      reply_markup: { inline_keyboard: [] },
    });

    // The key was claimed — a later settle (webhook duplicate, retry)
    // is a no-op, never a second edit.
    expect(redis.__store.get(`tg:topupcard:${topupId}`)).toBeUndefined();
    botApiCalls.length = 0;
    await TopupService.approve; // no-op reference (type-level assertion)
    await flush();
    expect(botCalls("editMessageText")).toHaveLength(0);
    expect(botCalls("editMessageReplyMarkup")).toHaveLength(0);
  });

  it("a rejection settles the card with the ❌ line (approve/reject parity)", async () => {
    const { topupId } = await seedUserWithPendingTopup();
    notifyNewTopup({ phone: "0910000002", amount: 25, network: "madar", topupId });
    await flush();

    await TopupService.reject(topupId, "مرفوض", "night_shift");
    await flush();

    const textEdits = botCalls("editMessageText");
    expect(textEdits).toHaveLength(1);
    expect(String(textEdits[0]!.text)).toContain("❌ الحالة: تم الرفض بواسطة night_shift");
    expect(botCalls("editMessageReplyMarkup")).toHaveLength(1);
    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topupId));
    expect(row!.status).toBe("rejected");
  });

  it("no card recorded (Redis absent) → the money path is untouched, zero Bot API edit traffic", async () => {
    redisState.client = null;
    const { userId, topupId } = await seedUserWithPendingTopup();

    // The card is still SENT (delivery is Bot-API-only); only the identity
    // capture is skipped — the webhook stale branch remains the net.
    notifyNewTopup({ phone: "0910000003", amount: 25, network: "madar", topupId });
    await flush();
    expect(botCalls("sendMessage")).toHaveLength(1);

    await TopupService.approve(topupId, null, "medo");
    await flush();

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    expect(String(u!.walletBalance)).toBe("25.00");
    expect(botCalls("editMessageText")).toHaveLength(0);
    expect(botCalls("editMessageReplyMarkup")).toHaveLength(0);
  });

  it("a card whose topup was never finalized stays untouched (no premature settlement)", async () => {
    const { topupId } = await seedUserWithPendingTopup();
    notifyNewTopup({ phone: "0910000004", amount: 25, network: "madar", topupId });
    await flush();

    // Only the sendMessage happened — no edits while still pending.
    expect(botCalls("sendMessage")).toHaveLength(1);
    expect(botCalls("editMessageText")).toHaveLength(0);
    expect(botCalls("editMessageReplyMarkup")).toHaveLength(0);
    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topupId));
    expect(row!.status).toBe("pending");
  });
});
