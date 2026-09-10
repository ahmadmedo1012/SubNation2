/**
 * 96-F1 (R96-A4 §1.3) — post-link settle gate + warm-up self-check.
 *
 * The production "Waiting for this message" incident: OpenWA reports a
 * freshly-paired session as `ready` before WhatsApp's multi-device key
 * distribution (sender-keys / prekeys / app-state sync) has propagated,
 * so an OTP dispatched in that window is undecryptable on the handset.
 *
 * Pinned here:
 *   A. Settle gate — the first `ready` observation opens a window
 *      (WHATSAPP_OTP_SETTLE_MS); sends inside it return the typed
 *      `session_settling` failure with a readyInMs estimate; the OTP send
 *      path bounded-waits up to 20 s and rides out windows that short.
 *   B. Warm-up self-check — with WHATSAPP_OTP_OPERATOR_E164 set, dispatch
 *      additionally requires a DELIVERED benign Arabic self-check to the
 *      operator's own number; a failed warm-up keeps dispatch gated.
 *   C. Honest readiness — the probe reports settling/readyInSec and
 *      never says `ready` inside the window.
 *   D. Send resilience — 5xx retries (1.5 s → 4 s, 3 attempts) with
 *      ensureSession re-run between attempts; 4xx never retried.
 *   E. readySince mirror — in-memory Map + Redis adoption (SETNX with a
 *      7-day TTL when fresh, GET-adoption on cold start).
 *   F. POST_LINK_SETTLE_MS env parsing + clamping.
 *
 * Fetch is mocked at the module boundary; the Redis singleton is mocked
 * (default: null — the no-Redis production shape) with an optional
 * capture client for the mirror tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "../../lib/redis-client";

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(),
  // Passthrough — the raced wrapper's timeout behavior is covered by
  // redis-client-resilience.test.ts; here we only care about the values.
  withRedisCommandTimeout: <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const getRedisClientMock = vi.mocked(getRedisClient);

const ORIGINAL_FETCH = globalThis.fetch;
const SESSION_ID = "sess_settle-1";
const SESSION_URL = `/api/sessions/${SESSION_ID}`;
const OPERATOR_E164 = "218913456789";
const WARMUP_TEXT = "قناة SubNation جاهزة ✓ (رسالة تهيئة)";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface MockGatewayOptions {
  /** Return value for GET /api/sessions/{id} (session record). */
  sessionStatus?: string | null;
  /** Handler for POST send-text — defaults to 200 success. */
  onSendText?: (call: FetchCall, sendCount: number) => Response | Promise<Response>;
}

function installFetchMock(opts: MockGatewayOptions = {}) {
  const calls: FetchCall[] = [];
  let sendCount = 0;
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: FetchCall = { url, init };
    calls.push(call);
    if (url.endsWith(SESSION_URL)) {
      if (opts.sessionStatus === null) return new Response("nf", { status: 404 });
      return jsonResponse({
        id: SESSION_ID,
        name: "subnation-otp",
        status: opts.sessionStatus ?? "ready",
      });
    }
    if (url.endsWith("/messages/send-text")) {
      sendCount += 1;
      if (opts.onSendText) return opts.onSendText(call, sendCount);
      return jsonResponse({ success: true });
    }
    // Preflight (contacts/check) — default: preflight unavailable → the
    // send path falls through (existing best-effort semantics).
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
  return {
    calls,
    get sendTextCalls() {
      return calls.filter((c) => c.url.endsWith("/messages/send-text"));
    },
  };
}

/** Capture-redis — records get/set args, replays scripted returns. */
function installCaptureRedis(behavior: { getReturns: string | null }) {
  const getCalls: string[] = [];
  const setCalls: Array<{ key: string; value: string; opts: { NX?: boolean; EX?: number } }> = [];
  getRedisClientMock.mockReturnValue({
    get: async (key: string) => {
      getCalls.push(key);
      return behavior.getReturns;
    },
    set: async (key: string, value: string, opts: { NX?: boolean; EX?: number } = {}) => {
      setCalls.push({ key, value, opts });
      return "OK";
    },
  } as unknown as ReturnType<typeof getRedisClient>);
  return { getCalls, setCalls };
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
  getRedisClientMock.mockReturnValue(null);
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── F. env parsing / clamping ───────────────────────────────────────────────

describe("POST_LINK_SETTLE_MS — env parsing + clamping (96-F1 §1.3A)", () => {
  it.each([
    ["unset → 45 s default", undefined, 45_000],
    ["garbage → 45 s default", "not-a-number", 45_000],
    ["0 → gate off for tests/dev", "0", 0],
    ["negative → clamped to 0", "-5000", 0],
    ["over-max → clamped to 300 s", "999999", 300_000],
    ["in-range honored", "12000", 12_000],
  ])("%s", async (_label, raw, expected) => {
    if (raw === undefined) delete process.env.WHATSAPP_OTP_SETTLE_MS;
    else process.env.WHATSAPP_OTP_SETTLE_MS = String(raw);
    vi.resetModules();
    const mod = await import("../openwa.service");
    expect(mod.POST_LINK_SETTLE_MS).toBe(expected);
  });
});

// ─── A. settle gate on the send path ─────────────────────────────────────────

describe("settle gate — send path (96-F1 §1.3A)", () => {
  it("rides out a short settle window inside ONE request (bounded wait), then delivers", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "5000";
    installFetchMock();

    const mod = await importOpenwa();
    vi.useFakeTimers();

    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    // The remaining 5 s window (≤ the 20 s cap) is awaited internally.
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await sendPromise;

    expect(result).toEqual({ ok: true });
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID)).toBeDefined();
  });

  it("gives up with session_settling (readyInMs) when the window exceeds the 20 s wait cap", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "60000";
    const mock = installFetchMock();

    const mod = await importOpenwa();
    vi.useFakeTimers();

    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    // Only the capped 20 s of the 60 s window is awaited…
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await sendPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_settling");
      // …so ~40 s of the window must remain in readyInMs.
      expect(result.readyInMs).toBeGreaterThan(39_000);
      expect(result.readyInMs).toBeLessThanOrEqual(40_000);
    }
    // No OTP text was dispatched while unsettled.
    expect(mock.sendTextCalls).toHaveLength(0);
  });

  it("records the first ready observation only once — later sends reuse the timestamp", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "30000";
    installFetchMock();
    const mod = await importOpenwa();

    vi.useFakeTimers();
    // First send: settles inside the capped wait? 30 s window > 20 s cap → settling.
    const first = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    await vi.advanceTimersByTimeAsync(20_000);
    const firstResult = await first;
    expect(firstResult.ok).toBe(false);

    const readySince = mod.__whatsappSettleGateTest.getReadySince(SESSION_ID);
    expect(readySince).toBeDefined();

    // Advance PAST the window, then send again — same timestamp, now settled.
    await vi.advanceTimersByTimeAsync(11_000);
    const second = await mod.sendWhatsAppMessage("218913456789@c.us", "code-2");
    const secondResult = await second;
    expect(secondResult).toEqual({ ok: true });
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID)).toBe(readySince);
  });
});

// ─── C. honest readiness probe ───────────────────────────────────────────────

describe("readiness probe — settling honesty (96-F1 §1.3C)", () => {
  it("reports settling:true + readyInSec during the window; never a premature ready", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "45000";
    installFetchMock();
    const mod = await importOpenwa();

    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({
      configured: true,
      ready: false,
      status: "ready",
      settling: true,
    });
    expect(r.readyInSec).toBeGreaterThan(0);
    expect(r.readyInSec).toBeLessThanOrEqual(45);

    // Probe observation also recorded the window start.
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID)).toBeDefined();
  });

  it("flips to ready only after the window elapses (30 s cache included in the wait)", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "45000";
    installFetchMock();
    const mod = await importOpenwa();

    vi.useFakeTimers();
    await mod.getWhatsAppGatewayReadiness(); // records the window start
    // Advance past BOTH the settle window and the 30 s probe cache TTL.
    await vi.advanceTimersByTimeAsync(46_000);
    const r2 = await mod.getWhatsAppGatewayReadiness();
    expect(r2).toMatchObject({ ready: true, settling: false, readyInSec: null, status: "ready" });
  });

  it("unpaired session still reports the lifecycle status (settling:false)", async () => {
    installFetchMock({ sessionStatus: "qr_ready" });
    const mod = await importOpenwa();
    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({
      ready: false,
      status: "qr_ready",
      settling: false,
      readyInSec: null,
    });
  });
});

// ─── B. warm-up self-check gating ────────────────────────────────────────────

describe("warm-up self-check — dispatch gating (96-F1 §1.3B)", () => {
  it("settled-but-not-warm returns session_settling even after the bounded wait (warm-up failed)", async () => {
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    // The warm-up self-check send fails on the gateway (500 — retried and
    // exhausted), so dispatchReady never flips.
    installFetchMock({
      onSendText: (call) => {
        const body = JSON.parse(String(call.init?.body ?? "{}")) as { chatId?: string };
        return body.chatId === `${OPERATOR_E164}@c.us`
          ? new Response("warmup failed", { status: 500 })
          : jsonResponse({ success: true });
      },
    });

    const mod = await importOpenwa();
    vi.useFakeTimers();

    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "otp-code");
    // Wait out the 10 s warmup-pending estimate (≤ the 20 s cap) plus the
    // warm-up's own retry backoff — dispatch must STILL be gated.
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await sendPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("session_settling");
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID)).toBe(false);
  });

  it("a delivered warm-up flips dispatchReady and un-gates OTP sends", async () => {
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    installFetchMock();
    const mod = await importOpenwa();

    // Run the warm-up cycle (the 6 h loop body) directly.
    await mod.__whatsappSettleGateTest.runWarmupCycle();

    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID)).toBe(true);
    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "otp-code");
    expect(result).toEqual({ ok: true });
  });

  it("the warm-up self-check targets the operator's own chatId with the benign Arabic text", async () => {
    process.env.WHATSAPP_OTP_OPERATOR_E164 = `+${OPERATOR_E164}`;
    const mock = installFetchMock();
    const mod = await importOpenwa();

    await mod.__whatsappSettleGateTest.runWarmupCycle();

    expect(mock.sendTextCalls).toHaveLength(1);
    const body = JSON.parse(String(mock.sendTextCalls[0]!.init?.body ?? "{}")) as {
      chatId: string;
      text: string;
    };
    // Leading + is tolerated and stripped — the chatId is E164 digits + @c.us.
    expect(body.chatId).toBe(`${OPERATOR_E164}@c.us`);
    expect(body.text).toBe(WARMUP_TEXT);
  });

  it("warm-up is skipped silently (no send, no gate) when the operator env is unset", async () => {
    delete process.env.WHATSAPP_OTP_OPERATOR_E164;
    const mock = installFetchMock();
    const mod = await importOpenwa();

    await mod.__whatsappSettleGateTest.runWarmupCycle();
    expect(mock.sendTextCalls).toHaveLength(0);
    // No operator → no warmup gate → dispatch relies on the settle gate only.
    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "otp-code");
    expect(result).toEqual({ ok: true });
  });

  it("runWarmupCycle is a no-op while the session is still settling (one-shot fires later)", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "60000";
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    const mock = installFetchMock();
    const mod = await importOpenwa();

    await mod.__whatsappSettleGateTest.runWarmupCycle();
    // Nothing sent inside the window…
    expect(mock.sendTextCalls).toHaveLength(0);
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID)).toBe(false);
  });

  it("readiness with operator configured reports ready only when settled AND warm", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "0";
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    installFetchMock();
    const mod = await importOpenwa();

    const before = await mod.getWhatsAppGatewayReadiness();
    expect(before).toMatchObject({ status: "ready", ready: false, settling: true });

    await mod.__whatsappSettleGateTest.runWarmupCycle();
    // Bust the 30 s probe cache to observe the fresh verdict.
    mod.__resetWhatsAppReadinessCacheForTests();
    const after = await mod.getWhatsAppGatewayReadiness();
    expect(after).toMatchObject({ status: "ready", ready: true, settling: false });
  });
});

// ─── D. send resilience ──────────────────────────────────────────────────────

describe("send retries — network/5xx only, never 4xx (96-F1 §1.3D)", () => {
  it("retries a 5xx with 1.5 s → 4 s backoff and succeeds on the second attempt", async () => {
    let sends = 0;
    installFetchMock({
      onSendText: () => {
        sends += 1;
        return sends === 1
          ? new Response("boom", { status: 502 })
          : jsonResponse({ success: true });
      },
    });
    const mod = await importOpenwa();

    vi.useFakeTimers();
    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await sendPromise;

    expect(result).toEqual({ ok: true });
    expect(sends).toBe(2);
  });

  it("retries a network error (fetch throw) and exhausts after 3 attempts", async () => {
    let sends = 0;
    installFetchMock({
      onSendText: () => {
        sends += 1;
        throw new Error("network black-hole");
      },
    });
    const mod = await importOpenwa();

    vi.useFakeTimers();
    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await sendPromise;

    expect(result).toEqual({ ok: false, reason: "request_failed" });
    expect(sends).toBe(3);
  });

  it("NEVER retries a 4xx — a single attempt, definitive verdict", async () => {
    let sends = 0;
    installFetchMock({
      onSendText: () => {
        sends += 1;
        return new Response("bad chatId", { status: 400 });
      },
    });
    const mod = await importOpenwa();

    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    expect(result).toEqual({ ok: false, reason: "non_ok_status", status: 400 });
    expect(sends).toBe(1);
  });
});

// ─── E. readySince Redis mirror ──────────────────────────────────────────────

describe("readySince Redis mirror — adoption + SETNX claim (96-F1 §1.3A)", () => {
  it("cold start ADOPTS the fleet timestamp from Redis (no fresh window)", async () => {
    // Observed 100 s ago — past any settle window used here (5 s).
    const adopted = Date.now() - 100_000;
    process.env.WHATSAPP_OTP_SETTLE_MS = "5000";
    const { setCalls } = installCaptureRedis({ getReturns: String(adopted) });
    installFetchMock();
    const mod = await importOpenwa();

    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    // Adopted (old) timestamp → settled immediately → dispatch proceeds.
    expect(result).toEqual({ ok: true });
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID)).toBe(adopted);
    // Adoption short-circuits BEFORE the SETNX claim.
    expect(setCalls).toHaveLength(0);
  });

  it("fresh observation claims via SETNX with a 7-day TTL", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "0";
    const { setCalls } = installCaptureRedis({ getReturns: null });
    installFetchMock();
    const mod = await importOpenwa();

    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    expect(result).toEqual({ ok: true });

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]!.key).toBe(`openwa:ready-since:${SESSION_ID}`);
    expect(setCalls[0]!.opts).toMatchObject({ NX: true, EX: 7 * 24 * 60 * 60 });
    expect(Number(setCalls[0]!.value)).toBeGreaterThan(0);
  });

  it("Redis degraded (null client) — in-memory only, dispatch still works", async () => {
    getRedisClientMock.mockReturnValue(null);
    installFetchMock();
    const mod = await importOpenwa();
    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    expect(result).toEqual({ ok: true });
  });
});
