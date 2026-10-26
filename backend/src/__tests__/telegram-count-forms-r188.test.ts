import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyCouponExpiringSoon, notifyCouponMaxedOut, notifyLowStock } from "../telegram";

/**
 * R188-3 (D-F2/D-F10/D-F11) — the Arabic count phrases on the operator
 * Telegram cards. The R188 linguistics audit found three frozen count
 * nouns: «N وحدة» on the low-stock card (the drawer twin lives in
 * stock-notify-gate.test.ts), «N مرة» on the coupon-maxed card, and
 * «N ساعة» on the expiring card. Every reachable count now renders the
 * grammatical form — one/two word forms, 3-10 «N <plural>», 11+ «N
 * <singular>» (lib/arabic-count.ts); these pins hold each branch.
 *
 * Fetch-stub + env discipline per telegram-coupon-expiry-tz (the
 * exemplar): dispatch is fire-and-forget with one transient retry, so
 * each leg waits a beat for the sendMessage to land. The stub restores
 * in afterAll; the env pair is deleted with it.
 */

const ORIGINAL_FETCH = globalThis.fetch;
const sendMessageBodies: Array<Record<string, unknown>> = [];

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN";
  process.env.TELEGRAM_CHAT_ID = "-1001234567890";
  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.telegram.org/")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      sendMessageBodies.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return ORIGINAL_FETCH(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

/** The text of the most recent dispatch, after letting it land. */
async function lastText(): Promise<string> {
  await new Promise((r) => setTimeout(r, 50));
  expect(sendMessageBodies.length).toBeGreaterThanOrEqual(1);
  return String(sendMessageBodies.at(-1)!.text);
}

describe("R188-3 (D-F2): notifyLowStock pluralizes the unit count", () => {
  it("1 / 2 / 3 units → «وحدة واحدة فقط» / «وحدتان فقط» / «3 وحدات فقط»", async () => {
    notifyLowStock({ productName: "Units One", stockCount: 1 });
    expect(await lastText()).toContain("المتوفر: وحدة واحدة فقط");
    notifyLowStock({ productName: "Units Two", stockCount: 2 });
    expect(await lastText()).toContain("المتوفر: وحدتان فقط");
    notifyLowStock({ productName: "Units Three", stockCount: 3 });
    expect(await lastText()).toContain("المتوفر: 3 وحدات فقط");
  });

  it("the zero branch keeps its dedicated line («لا توجد وحدات متبقية»)", async () => {
    notifyLowStock({ productName: "Units Zero", stockCount: 0 });
    expect(await lastText()).toContain("المتوفر: لا توجد وحدات متبقية");
  });
});

describe("R188-3 (D-F10): notifyCouponMaxedOut pluralizes «مرة»", () => {
  it("1 / 2 / 5 / 15 maxUses → «مرة واحدة» / «مرتين» / «5 مرات» / «15 مرة»", async () => {
    notifyCouponMaxedOut("MAX1", 1);
    expect(await lastText()).toContain("تم استخدامه <b>مرة واحدة</b> (الحد الأقصى)");
    notifyCouponMaxedOut("MAX2", 2);
    expect(await lastText()).toContain("تم استخدامه <b>مرتين</b> (الحد الأقصى)");
    notifyCouponMaxedOut("MAX5", 5);
    expect(await lastText()).toContain("تم استخدامه <b>5 مرات</b> (الحد الأقصى)");
    notifyCouponMaxedOut("MAX15", 15);
    expect(await lastText()).toContain("تم استخدامه <b>15 مرة</b> (الحد الأقصى)");
  });
});

describe("R188-3 (D-F11): notifyCouponExpiringSoon pluralizes integer hours", () => {
  it("floor 1 / 2 / 5 / 15 → «ساعة واحدة» / «2 ساعات» / «5 ساعات» / «15 ساعة»", async () => {
    const expiresAt = new Date(Date.now() + 16 * 60 * 60 * 1000);
    notifyCouponExpiringSoon("EXP1X", expiresAt, 1.5);
    expect(await lastText()).toContain("ينتهي خلال: <b>ساعة واحدة</b>");
    notifyCouponExpiringSoon("EXP2X", expiresAt, 2.9);
    expect(await lastText()).toContain("ينتهي خلال: <b>2 ساعات</b>");
    notifyCouponExpiringSoon("EXP5", expiresAt, 5);
    expect(await lastText()).toContain("ينتهي خلال: <b>5 ساعات</b>");
    notifyCouponExpiringSoon("EXP15", expiresAt, 15);
    expect(await lastText()).toContain("ينتهي خلال: <b>15 ساعة</b>");
  });

  it("the sub-hour guard keeps «أقل من ساعة» untouched", async () => {
    notifyCouponExpiringSoon("EXP09", new Date(Date.now() + 30 * 60 * 1000), 0.5);
    expect(await lastText()).toContain("ينتهي خلال: <b>أقل من ساعة</b>");
  });
});
