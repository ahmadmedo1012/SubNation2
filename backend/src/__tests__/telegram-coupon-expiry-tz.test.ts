import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyCouponExpiringSoon } from "../telegram";

/**
 * R143 (L14-5) — the coupon-expiry Telegram card renders in Libya time.
 *
 * notifyCouponExpiringSoon's «وقت الانتهاء» line formatted the SAME expiry
 * the admin drawer shows (couponWatcher formats it with
 * timeZone:"Africa/Tripoli") in the SERVER's process TZ — UTC under the
 * production image (Dockerfile pins TZ=UTC) — so the card contradicted
 * both its own adjacent relative label («ينتهي خلال: N ساعة») and the
 * drawer by 2 hours. The fix pins timeZone:"Africa/Tripoli", matching the
 * sibling timestampLine() in the same module.
 *
 * Deterministic both-reference pin: the expected TRIPOLI and UTC renderings
 * are computed with EXPLICIT timeZones in the test (no runner-TZ
 * dependence), over an instant whose two renderings differ —
 * 2026-03-05T23:30Z is «01:30» on March 6 in Tripoli and «23:30» on
 * March 5 in UTC.
 */

const ORIGINAL_FETCH = globalThis.fetch;
const sendMessageBodies: Array<Record<string, unknown>> = [];

const BOT_TOKEN = "123456:TEST-TOKEN";
const CHAT_ID = "-1001234567890";

/** An instant whose Tripoli and UTC renderings differ on BOTH date+hour. */
const EXPIRY = new Date("2026-03-05T23:30:00.000Z");

function renderAt(tz: string): string {
  return EXPIRY.toLocaleDateString("ar-LY", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT_ID;
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

describe("R143 (L14-5): notifyCouponExpiringSoon renders the expiry in Africa/Tripoli", () => {
  it("the card's «وقت الانتهاء» line carries the Tripoli rendering, not the process-TZ (UTC) one", async () => {
    const tripoli = renderAt("Africa/Tripoli");
    const utc = renderAt("UTC");
    // Fixture guard: the two references must genuinely differ (date AND
    // hour), or the pin below is vacuous.
    expect(tripoli).not.toBe(utc);

    notifyCouponExpiringSoon("TZCHECK", EXPIRY, 5);

    // dispatch is fire-and-forget with one transient retry — give the
    // microtask chain a beat to land the sendMessage.
    await new Promise((r) => setTimeout(r, 50));

    expect(sendMessageBodies.length).toBeGreaterThanOrEqual(1);
    const text = String(sendMessageBodies[0]!.text);
    expect(text).toContain("وقت الانتهاء:");
    expect(text).toContain(tripoli);
    // The pre-fix shape: the UTC rendering riding the card.
    expect(text).not.toContain(utc);
  });
});
