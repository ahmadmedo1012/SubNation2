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
 *   G. 97-F3 (R97-WA-01) settle-gate RE-ARM on re-pair — the gate key is
 *      composite (sessionId + lastReadyAt epoch token): a re-pair under
 *      the SAME session id (the live production incident) re-arms the
 *      full window, drops dispatchReady, re-schedules the warm-up, and
 *      reads a FRESH Redis mirror key. WA-03 partial: the warm-up
 *      verdict is epoch-scoped.
 *
 * Fetch is mocked at the module boundary; the Redis singleton is mocked
 * (default: null — the no-Redis production shape) with an optional
 * capture client for the mirror tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "../../lib/redis-client";

// R104 (AG4-2): the Neon-persisted epoch marker is mocked out HERE —
// these are unit tests of the in-memory gate. The marker adoption path
// (store round-trip, adopt-on-epoch-match, fresh-window-on-re-pair,
// warmed adoption, kill switch) is covered END-TO-END against the real
// store + pglite harness in openwa-epoch-memory.test.ts.
vi.mock("../../lib/whatsapp-epoch-store", () => ({
  readEpochMarker: vi.fn(async () => null),
  writeEpochMarker: vi.fn(),
  epochMemoryEnabled: vi.fn(() => false),
}));

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
  /**
   * 97-F3 (WA-01): the gateway session's `lastReadyAt` pairing-epoch
   * token — a fixed value, or a getter so a test can flip it mid-flight
   * to simulate a re-pair under the same session id. Omitted → legacy
   * gateway shape (no field on the wire; the gate keys on the bare id).
   */
  lastReadyAt?: string | (() => string | undefined);
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
      const epoch = typeof opts.lastReadyAt === "function" ? opts.lastReadyAt() : opts.lastReadyAt;
      return jsonResponse({
        id: SESSION_ID,
        name: "subnation-otp",
        status: opts.sessionStatus ?? "ready",
        ...(epoch ? { lastReadyAt: epoch } : {}),
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

  it("NEVER retries a definitive 4xx (400) — a single attempt, definitive verdict", async () => {
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

  // B5-4 (R111): 409 is the ONE 4xx exception — the gateway's
  // "session_not_ready at send time" flap (session flipped off ready
  // between our ensureSession check and the dispatch). It rides the
  // same 1.5 s → 4 s backoff + ensureSession-recheck loop as 5xx.
  it("retries a 409 mid-send flap and succeeds once the session settles again (B5-4)", async () => {
    let sends = 0;
    installFetchMock({
      onSendText: () => {
        sends += 1;
        return sends === 1
          ? new Response("session_not_ready", { status: 409 })
          : jsonResponse({ success: true });
      },
    });
    const mod = await importOpenwa();

    vi.useFakeTimers();
    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await sendPromise;

    expect(result).toEqual({ ok: true });
    expect(sends).toBe(2); // pre-B5-4: a single 409 attempt → non_ok_status
  });

  it("a PERSISTENT 409 flap exhausts into the typed non_ok_status(409) verdict after 3 attempts (B5-4)", async () => {
    let sends = 0;
    installFetchMock({
      onSendText: () => {
        sends += 1;
        return new Response("session_not_ready", { status: 409 });
      },
    });
    const mod = await importOpenwa();

    vi.useFakeTimers();
    const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await sendPromise;

    expect(result).toEqual({ ok: false, reason: "non_ok_status", status: 409 });
    expect(sends).toBe(3);
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

// ─── G. 97-F3 (R97-WA-01): settle-gate re-arm on re-pair ────────────────────

describe("settle gate — pairing-epoch re-arm (97-F3 / R97-WA-01)", () => {
  const EPOCH_A = "2026-09-10T17:24:40.000Z"; // the dead pairing's lastReadyAt
  const EPOCH_B = "2026-09-11T09:02:11.000Z"; // the re-pair's fresh lastReadyAt

  it("a NEW lastReadyAt under the same session id re-arms the FULL settle window", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "45000";
    let epoch = EPOCH_A;
    installFetchMock({ lastReadyAt: () => epoch });
    const mod = await importOpenwa();
    vi.useFakeTimers();

    // First ready observation under epoch A → 45 s window.
    const r1 = await mod.getWhatsAppGatewayReadiness();
    expect(r1).toMatchObject({ status: "ready", ready: false, settling: true });
    expect(r1.readyInSec).toBeGreaterThan(0);
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_A)).toBeDefined();

    // Window elapses + probe cache expires → ready.
    await vi.advanceTimersByTimeAsync(46_000);
    const r2 = await mod.getWhatsAppGatewayReadiness();
    expect(r2).toMatchObject({ ready: true, settling: false, readyInSec: null });

    // The operator re-pairs: SAME session id, gateway stamps a NEW lastReadyAt.
    epoch = EPOCH_B;
    await vi.advanceTimersByTimeAsync(31_000); // probe cache expiry
    const r3 = await mod.getWhatsAppGatewayReadiness();
    // The gate re-armed: ready collapses back to false with a FULL window.
    expect(r3).toMatchObject({ status: "ready", ready: false, settling: true });
    expect(r3.readyInSec).toBeGreaterThan(44);
    expect(r3.readyInSec).toBeLessThanOrEqual(45);
    // Old epoch's ready-since is wiped; the new epoch records fresh; the
    // observed-epoch memory follows the wire.
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_A)).toBeUndefined();
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_B)).toBeDefined();
    expect(mod.__whatsappSettleGateTest.getObservedEpoch(SESSION_ID)).toBe(EPOCH_B);
  });

  it("the SAME lastReadyAt keeps the steady state — no re-arm", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "45000";
    installFetchMock({ lastReadyAt: EPOCH_A });
    const mod = await importOpenwa();
    vi.useFakeTimers();

    await mod.getWhatsAppGatewayReadiness(); // window opens under epoch A
    const readySinceA = mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_A);
    expect(readySinceA).toBeDefined();

    await vi.advanceTimersByTimeAsync(46_000);
    expect(await mod.getWhatsAppGatewayReadiness()).toMatchObject({
      ready: true,
      settling: false,
    });

    // Much later, SAME epoch token → still settled, SAME timestamp.
    await vi.advanceTimersByTimeAsync(31_000);
    const r3 = await mod.getWhatsAppGatewayReadiness();
    expect(r3).toMatchObject({ ready: true, settling: false, readyInSec: null });
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_A)).toBe(readySinceA);
  });

  it("the epoch token is compared OPAQUELY — an out-of-order (earlier) new lastReadyAt still re-arms", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "45000";
    // Gateway clock skew: the NEW pairing stamps an EARLIER timestamp. A
    // time-diff comparison would call it "not newer" and miss the re-pair;
    // a string comparison cannot.
    let epoch = "2026-09-12T00:00:00.000Z";
    installFetchMock({ lastReadyAt: () => epoch });
    const mod = await importOpenwa();
    vi.useFakeTimers();

    await mod.getWhatsAppGatewayReadiness();
    await vi.advanceTimersByTimeAsync(46_000);
    expect(await mod.getWhatsAppGatewayReadiness()).toMatchObject({ ready: true });

    epoch = "2026-09-11T23:00:00.000Z"; // EARLIER than the previous token
    await vi.advanceTimersByTimeAsync(31_000);
    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({ ready: false, settling: true });
    expect(r.readyInSec).toBeGreaterThan(44);
  });

  it("re-pair drops dispatchReady — a fresh epoch-scoped self-check must deliver before dispatch re-enables (WA-03 partial)", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "0";
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    let epoch = EPOCH_A;
    const mock = installFetchMock({ lastReadyAt: () => epoch });
    const mod = await importOpenwa();
    vi.useFakeTimers();
    // Distinct from the operator number so the self-check texts are
    // unambiguously separable from the OTP dispatches below.
    const RECIPIENT = "218914460503@c.us";

    // Old pairing: warm-up delivered → dispatch enabled → OTP flows.
    await mod.__whatsappSettleGateTest.runWarmupCycle();
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, EPOCH_A)).toBe(true);
    expect(await mod.sendWhatsAppMessage(RECIPIENT, "otp-1")).toEqual({ ok: true });

    // Let the send-path ready cache (30 s) lapse so the re-pair is observed.
    await vi.advanceTimersByTimeAsync(31_000);

    // Re-pair under the SAME session id: the readiness verdict collapses…
    epoch = EPOCH_B;
    mod.__resetWhatsAppReadinessCacheForTests();
    const probe = await mod.getWhatsAppGatewayReadiness();
    expect(probe).toMatchObject({ status: "ready", ready: false, settling: true });
    // …and the epoch-scoped warm flag is gone — for BOTH keys (the old
    // pairing's flag was dropped by the re-arm, not just overshadowed).
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, EPOCH_B)).toBe(false);
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, EPOCH_A)).toBe(false);

    // A send right after the re-pair is gated, then bounded-waits (~10 s
    // warm-up estimate) — during which the RE-SCHEDULED one-shot
    // self-check delivers for the NEW epoch and un-gates dispatch within
    // the SAME request (the 96-F1 bounded-wait contract, re-armed).
    const sendPromise = mod.sendWhatsAppMessage(RECIPIENT, "otp-2");
    await vi.advanceTimersByTimeAsync(21_000);
    await expect(sendPromise).resolves.toEqual({ ok: true });

    // Exactly TWO self-check texts total: one per pairing epoch.
    const warmupCalls = mock.sendTextCalls.filter((c) => {
      const body = JSON.parse(String(c.init?.body ?? "{}")) as { text?: string };
      return body.text === WARMUP_TEXT;
    });
    expect(warmupCalls).toHaveLength(2);
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, EPOCH_B)).toBe(true);
    expect(await mod.sendWhatsAppMessage(RECIPIENT, "otp-3")).toEqual({ ok: true });
  });

  it("the initial warm-up one-shot re-schedules for the new epoch after a re-arm", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "5000";
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    let epoch = EPOCH_A;
    const mock = installFetchMock({ lastReadyAt: () => epoch });
    const mod = await importOpenwa();
    vi.useFakeTimers();

    // Probe opens the epoch-A window and schedules its one-shot warm-up.
    await mod.getWhatsAppGatewayReadiness();

    // Re-pair happens INSIDE the window — the one-shot's cycle then
    // observes the new epoch, re-arms, and re-schedules for epoch B.
    epoch = EPOCH_B;
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.advanceTimersByTimeAsync(40_000);

    // Exactly ONE self-check was sent — for the NEW epoch — and it armed
    // the NEW epoch's dispatch gate (the old epoch's is gone).
    expect(mock.sendTextCalls).toHaveLength(1);
    const body = JSON.parse(String(mock.sendTextCalls[0]!.init?.body ?? "{}")) as {
      chatId?: string;
      text?: string;
    };
    expect(body.chatId).toBe(`${OPERATOR_E164}@c.us`);
    expect(body.text).toBe(WARMUP_TEXT);
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, EPOCH_B)).toBe(true);
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, EPOCH_A)).toBe(false);
  });

  it("the Redis mirror is keyed per-epoch — a re-pair claims a FRESH key (never adopts the dead pairing's timestamp)", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "0";
    let epoch = EPOCH_A;
    const { setCalls } = installCaptureRedis({ getReturns: null });
    installFetchMock({ lastReadyAt: () => epoch });
    const mod = await importOpenwa();

    await mod.getWhatsAppGatewayReadiness(); // claims gk(EPOCH_A)
    epoch = EPOCH_B;
    mod.__resetWhatsAppReadinessCacheForTests();
    await mod.getWhatsAppGatewayReadiness(); // re-pair → claims gk(EPOCH_B)

    expect(setCalls).toHaveLength(2);
    expect(setCalls[0]!.key).toBe(`openwa:ready-since:${SESSION_ID}::${EPOCH_A}`);
    expect(setCalls[1]!.key).toBe(`openwa:ready-since:${SESSION_ID}::${EPOCH_B}`);
    for (const call of setCalls) {
      expect(call.opts).toMatchObject({ NX: true, EX: 7 * 24 * 60 * 60 });
    }
    // Old epoch bookkeeping wiped on the re-arm; new epoch present.
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_A)).toBeUndefined();
    expect(mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, EPOCH_B)).toBeDefined();
  });

  it("legacy gateway shape (no lastReadyAt on the wire) — gate keys on the bare session id, exactly the pre-97-F3 behavior", async () => {
    process.env.WHATSAPP_OTP_SETTLE_MS = "0";
    const { setCalls } = installCaptureRedis({ getReturns: null });
    installFetchMock(); // no lastReadyAt
    const mod = await importOpenwa();

    await mod.getWhatsAppGatewayReadiness();

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]!.key).toBe(`openwa:ready-since:${SESSION_ID}`);
    expect(mod.__whatsappSettleGateTest.getObservedEpoch(SESSION_ID)).toBe("");
  });
});

// ─── B5-1 (R111): warm-up failure latch — idempotent re-arm on the send path ──

describe("warm-up failure latch — one transient failure must not gate dispatch until restart (B5-1)", () => {
  // Distinct from the operator number so self-check texts and OTP
  // dispatches are unambiguously separable (re-pair suite precedent).
  const OTP_RECIPIENT = "218914460503@c.us";

  it("a FAILED one-shot warm-up re-arms on the next OTP attempt and delivers (no latch)", async () => {
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    // The warm-up self-check fails on its first cycle (500 — retried and
    // exhausted), then succeeds when re-armed. OTP sends always succeed.
    let warmupCycles = 0;
    const mock = installFetchMock({
      onSendText: (call) => {
        const body = JSON.parse(String(call.init?.body ?? "{}")) as { chatId?: string };
        if (body.chatId === `${OPERATOR_E164}@c.us`) {
          warmupCycles += 1;
          return warmupCycles <= 3
            ? new Response("warmup failed", { status: 500 })
            : jsonResponse({ success: true });
        }
        return jsonResponse({ success: true });
      },
    });
    const mod = await importOpenwa();
    vi.useFakeTimers();

    // First OTP attempt: settle=0 → settled but not warm; the one-shot
    // warm-up fires during the bounded wait and its self-check FAILS
    // (3 retried attempts) → dispatch stays gated for THIS request.
    const first = mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-1");
    await vi.advanceTimersByTimeAsync(10_000); // 10 s warm-up-pending estimate
    const firstResult = await first;
    expect(firstResult).toMatchObject({ ok: false, reason: "session_settling" });

    // THE LATCH (pre-B5-1): recordReadySince's `known !== undefined`
    // early-return meant the failed one-shot could never be re-scheduled
    // — every later OTP answered session_settling until process restart.
    // Post-B5-1 the gated ensureSession re-arms it (idempotently — a
    // no-op while pending): the re-armed cycle delivers…
    await vi.advanceTimersByTimeAsync(2_000);

    // …so the SECOND OTP attempt rides the wake and lands.
    const second = mod.sendWhatsAppMessage(OTP_RECIPIENT, "otp-2");
    await vi.advanceTimersByTimeAsync(12_000);
    const secondResult = await second;

    expect(secondResult).toEqual({ ok: true });
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID)).toBe(true);
    // Exactly 3 failed self-check attempts + 1 delivered re-arm — one
    // failed cycle, one re-armed cycle, nothing more.
    const warmupTexts = mock.sendTextCalls.filter((c) => {
      const body = JSON.parse(String(c.init?.body ?? "{}")) as { chatId?: string };
      return body.chatId === `${OPERATOR_E164}@c.us`;
    });
    expect(warmupTexts).toHaveLength(4);
    // And exactly two OTP dispatches (otp-1 was gated, otp-2 delivered).
    const otpTexts = mock.sendTextCalls.filter((c) => {
      const body = JSON.parse(String(c.init?.body ?? "{}")) as { chatId?: string };
      return body.chatId === OTP_RECIPIENT;
    });
    expect(otpTexts).toHaveLength(1);
  });

  it("the re-arm is idempotent — a gated request runs at most the initial one-shot + ONE re-armed cycle, never a timer pile-up (B5-1)", async () => {
    process.env.WHATSAPP_OTP_OPERATOR_E164 = OPERATOR_E164;
    let warmupSends = 0;
    installFetchMock({
      onSendText: (call) => {
        const body = JSON.parse(String(call.init?.body ?? "{}")) as { chatId?: string };
        if (body.chatId === `${OPERATOR_E164}@c.us`) {
          warmupSends += 1;
          return new Response("warmup still failing", { status: 500 });
        }
        return jsonResponse({ success: true });
      },
    });
    const mod = await importOpenwa();
    vi.useFakeTimers();

    // Three gated OTP attempts in a row against a channel whose warm-up
    // keeps failing. Per request there are exactly TWO ensureSession
    // calls (the initial check + the bounded-wait recheck) → at most the
    // initial one-shot cycle + ONE re-armed cycle = 6 self-check sends
    // (3 transport attempts each). The pending-guard inside
    // scheduleInitialWarmup is what keeps concurrent gated attempts from
    // stacking cycles — a runaway here would blow far past 6/request.
    for (let i = 0; i < 3; i++) {
      const before = warmupSends;
      const send = mod.sendWhatsAppMessage(OTP_RECIPIENT, `otp-${i + 1}`);
      await vi.advanceTimersByTimeAsync(20_000); // bounded wait + one full retry cycle
      const result = await send;
      expect(result).toMatchObject({ ok: false, reason: "session_settling" });
      expect(warmupSends - before).toBe(6); // 2 cycles × 3 attempts — bounded
    }

    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID)).toBe(false);
  });
});

// ─── B5-3 (R111): restore-residual floor clamp ────────────────────────────────

describe("restore-residual adoption — never a FUTURE readySince (B5-3)", () => {
  it("SETTLE_MS below the 5 s residual floor adopts a readySince ≤ now (clamped, not future)", async () => {
    // 2 s settle window < RESTORE_RESIDUAL_SETTLE_MS (5 s): the floor
    // arithmetic used to compute now - (2000 - 5000) = now + 3000 — a
    // FUTURE timestamp the window counted down from.
    process.env.WHATSAPP_OTP_SETTLE_MS = "2000";
    const epoch = "2026-09-20T06:15:00.000Z";
    const markerReadySince = Date.now() - 60_000; // pre-sleep epoch, 60 s old
    installFetchMock({ lastReadyAt: epoch });
    const epochStore = await import("../../lib/whatsapp-epoch-store");
    const readMock = vi.mocked(epochStore.readEpochMarker);
    readMock.mockResolvedValue({ epoch, readySince: markerReadySince, warmed: false });
    const mod = await importOpenwa();
    try {
      vi.useFakeTimers();
      const sendPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
      // Let the async chain run up to (but not past) the bounded settle
      // wait, so the ADOPTED timestamp is already recorded.
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      }

      const adopted = mod.__whatsappSettleGateTest.getReadySince(SESSION_ID, epoch);
      expect(adopted).toBeDefined();
      // B5-3: the clamp — never in the future (pre-fix: now + 3000).
      expect(adopted!).toBeLessThanOrEqual(Date.now());
      // …and never older than the marker it adopted.
      expect(adopted!).toBeGreaterThanOrEqual(markerReadySince);

      // The 2 s window then elapses inside the bounded wait → dispatch.
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(sendPromise).resolves.toEqual({ ok: true });
    } finally {
      readMock.mockReset();
      readMock.mockImplementation(async () => null);
    }
  });
});
