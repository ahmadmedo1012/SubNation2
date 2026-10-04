/**
 * B5-5 (R111) — the send-path OUTCOME feeds the channel-death watch.
 *
 * The 97-F3 watch was observation-driven since 2026-09-20, but only the
 * PRE-send ensureSession verdict ever fed it. Two blind spots:
 *
 *   1. STREAK RESET — a channel that went unhealthy on probes (or on one
 *      bad OTP attempt) but kept DELIVERING OTPs sat on a stale unhealthy
 *      streak forever: a successful send is the strongest healthy
 *      observation there is, yet it was never fed. A later probe
 *      blip then alerted as if the channel had been dead the whole time.
 *
 *   2. READY-FOR-PROBE, DEAD-FOR-SEND — a session that reports `ready`
 *      to probes but fails every actual send (engine wedged, warm-up
 *      self-check failing) produced healthy-looking observations while
 *      every OTP 503'd. The watch never heard about it.
 *
 * Pinned here (whatsapp-watch mocked at the module boundary — its own
 * state machine has dedicated coverage in whatsapp-watch.test.ts):
 *   - a delivered OTP send feeds { configured: true, status: "ready" };
 *   - an exhausted wire failure (5xx) feeds send_<status>;
 *   - recipient_not_on_whatsapp feeds NOTHING (client-side condition —
 *     a wrong number must never start a death-watch streak);
 *   - the pre-send ensureSession failure feed keeps its taxonomy
 *     (qr_ready / not_found / settling / unreachable) — now via the
 *     shared sendFailureWatchStatus helper;
 *   - the warm-up self-check feeds ready on delivery and send_<status>
 *     on failure (the sharpest ready-for-probe-dead-for-send signal).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../whatsapp-watch", () => ({
  observeWhatsAppChannel: vi.fn(),
  // A9-2 (R116): the rolling send-failure counter — same mock surface.
  observeWhatsAppSendFailure: vi.fn(),
}));

import { observeWhatsAppChannel, observeWhatsAppSendFailure } from "../whatsapp-watch";

vi.mock("../../lib/whatsapp-epoch-store", () => ({
  readEpochMarker: vi.fn(async () => null),
  writeEpochMarker: vi.fn(),
}));

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(() => null),
  withRedisCommandTimeout: <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const observeMock = vi.mocked(observeWhatsAppChannel);
const observeFailureMock = vi.mocked(observeWhatsAppSendFailure);

const ORIGINAL_FETCH = globalThis.fetch;
const SESSION_ID = "sess_watch_1";
const SESSION_URL = `/api/sessions/${SESSION_ID}`;
const OPERATOR_E164 = "218913456789";
const OTP_RECIPIENT = "218914460503@c.us";
const OTP_RECIPIENT_DIGITS = "218914460503";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface MockGatewayOptions {
  sessionStatus?: string;
  /** Handler for POST send-text — defaults to 200 success. */
  onSendText?: (call: { url: string; init: RequestInit | undefined }) => Response;
  /** Handler for the contacts/check preflight — defaults to exists:true. */
  onPreflight?: () => Response;
}

function installFetchMock(opts: MockGatewayOptions = {}) {
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call = { url, init };
    if (url.endsWith(SESSION_URL)) {
      return jsonResponse({
        id: SESSION_ID,
        name: "subnation-otp",
        status: opts.sessionStatus ?? "ready",
      });
    }
    if (url.endsWith("/contacts/check/" + OTP_RECIPIENT_DIGITS)) {
      return opts.onPreflight ? opts.onPreflight() : jsonResponse({ exists: true });
    }
    if (url.endsWith("/messages/send-text")) {
      return opts.onSendText ? opts.onSendText(call) : jsonResponse({ success: true });
    }
    return jsonResponse({ ok: true });
  }) as unknown as typeof fetch;
}

async function importOpenwa() {
  const mod = await import("../openwa.service");
  mod.__resetWhatsAppGatewayCacheForTests();
  mod.__resetWhatsAppReadinessCacheForTests();
  return mod;
}

beforeEach(() => {
  process.env.WHATSAPP_OTP_BASE_URL = "http://openwa.test";
  process.env.WHATSAPP_OTP_API_KEY = "owa_k1_test_key";
  process.env.WHATSAPP_OTP_SESSION = SESSION_ID;
  process.env.WHATSAPP_OTP_SETTLE_MS = "0";
  delete process.env.WHATSAPP_OTP_OPERATOR_E164;
  observeMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("send-path outcomes feed the channel-death watch (B5-5, R111)", () => {
  it("a DELIVERED OTP send feeds a healthy ready observation (streak reset)", async () => {
    installFetchMock();
    const mod = await importOpenwa();

    const result = await mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-code");

    expect(result).toEqual({ ok: true });
    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(observeMock).toHaveBeenCalledWith({ configured: true, status: "ready" });
  });

  it("an exhausted 5xx send feeds send_<status> — the ready-for-probe dead-for-send shape", async () => {
    let sends = 0;
    installFetchMock({
      onSendText: () => {
        sends += 1;
        return new Response("engine wedged", { status: 500 });
      },
    });
    const mod = await importOpenwa();

    vi.useFakeTimers();
    const sendPromise = mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-code");
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await sendPromise;

    expect(result).toMatchObject({ ok: false, reason: "non_ok_status", status: 500 });
    expect(sends).toBe(3);
    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(observeMock).toHaveBeenCalledWith({ configured: true, status: "send_500" });
    // A9-2 (R116): the exhausted send also feeds the rolling failure counter.
    expect(observeFailureMock).toHaveBeenCalledTimes(1);
    expect(observeFailureMock).toHaveBeenCalledWith("send_500");
  });

  it("recipient_not_on_whatsapp feeds NOTHING — a wrong number is not channel health", async () => {
    installFetchMock({
      onPreflight: () => jsonResponse({ exists: false }),
    });
    const mod = await importOpenwa();

    const result = await mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-code");

    expect(result).toEqual({ ok: false, reason: "recipient_not_on_whatsapp" });
    expect(observeMock).not.toHaveBeenCalled();
  });

  it("the pre-send ensureSession failure keeps feeding the raw lifecycle status (regression guard)", async () => {
    installFetchMock({ sessionStatus: "qr_ready" });
    const mod = await importOpenwa();

    const result = await mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-code");

    expect(result).toMatchObject({
      ok: false,
      reason: "session_not_ready",
      sessionStatus: "qr_ready",
    });
    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(observeMock).toHaveBeenCalledWith({ configured: true, status: "qr_ready" });
    // A9-2 (R116): the pre-send failure also feeds the rolling failure
    // counter with the RAW lifecycle status (same taxonomy as the
    // channel feed). No exact count — a pending observation from an
    // earlier test's module instance can land inside this window (the
    // mock is file-shared); the LAST call is this test's feed.
    expect(observeFailureMock).toHaveBeenCalledWith("qr_ready");
    expect(observeFailureMock.mock.lastCall?.[0]).toBe("qr_ready");
  });

  it("a delivered warm-up self-check feeds ready; a failing one feeds send_<status>", async () => {
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    let operatorSends = 0;
    installFetchMock({
      onSendText: (call) => {
        const body = JSON.parse(String(call.init?.body ?? "{}")) as { chatId?: string };
        if (body.chatId === `${OPERATOR_E164}@c.us`) {
          operatorSends += 1;
          // First self-check cycle fails (500, retried + exhausted), the
          // B5-1 re-armed second cycle delivers.
          return operatorSends <= 3
            ? new Response("warmup failed", { status: 500 })
            : jsonResponse({ success: true });
        }
        return jsonResponse({ success: true });
      },
    });
    const mod = await importOpenwa();
    observeMock.mockReset();
    vi.useFakeTimers();

    // First OTP attempt: the initial one-shot warm-up FAILS (feed:
    // send_500), the request settles-verdicts out (feed: settling — the
    // healthy gate status), then the B5-1 re-armed cycle DELIVERS
    // (feed: ready).
    const first = mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-code");
    await vi.advanceTimersByTimeAsync(20_000);
    const firstResult = await first;
    expect(firstResult).toMatchObject({ ok: false, reason: "session_settling" });

    // Second attempt: dispatch is now warm → the OTP lands (feed: ready).
    const second = await mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-code-2");
    expect(second).toEqual({ ok: true });

    expect(observeMock.mock.calls.map((c) => c[0])).toEqual([
      { configured: true, status: "send_500" }, // the failed self-check cycle
      { configured: true, status: "settling" }, // the gated request's verdict (healthy)
      { configured: true, status: "ready" }, // the re-armed self-check delivered
      { configured: true, status: "ready" }, // the OTP send delivered
    ]);
  });
});
