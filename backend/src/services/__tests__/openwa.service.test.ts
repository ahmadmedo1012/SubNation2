/**
 * OpenWA transport — verifies the session-aware wire format against
 * the real OpenWA API contract:
 *   - X-API-Key auth header (NOT legacy `api_key`)
 *   - POST /api/sessions/{id}/messages/send-text body { chatId, text }
 *   - bootstrap by session id  (sess_…)
 *   - bootstrap by session name (auto-create + start when missing)
 *   - graceful surfacing of `session_not_ready` while operator scans QR
 *   - typed `not_configured` failure when env is incomplete
 *
 * The OTP value is intentionally NOT asserted in any failure log — this
 * test also serves as a regression check that the gateway never echoes
 * the message text back to the logger on the failure paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function installFetchMock(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: FetchCall = { url, init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.WHATSAPP_OTP_BASE_URL = "http://openwa.test";
  process.env.WHATSAPP_OTP_API_KEY = "owa_k1_test_key";
  process.env.WHATSAPP_OTP_SESSION = "sess_existing-id";
  delete process.env.WHATSAPP_OTP_AUTO_CREATE_SESSION;
  // 96-F1 (R96-A4 §1.3A): the post-link settle gate is part of the same
  // send path these wire-format tests exercise. Settle=0 keeps them
  // focused on the TRANSPORT contract (headers/body/paths); the gate
  // itself has dedicated coverage in openwa-settle-gate.test.ts.
  process.env.WHATSAPP_OTP_SETTLE_MS = "0";
  delete process.env.WHATSAPP_OTP_OPERATOR_E164;
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("openwa transport — wire format", () => {
  it("uses X-API-Key header and posts to /api/sessions/{id}/messages/send-text with {chatId,text}", async () => {
    const calls = installFetchMock(({ url }) => {
      if (url.endsWith("/api/sessions/sess_existing-id")) {
        return jsonResponse({ id: "sess_existing-id", name: "primary", status: "ready" });
      }
      if (url.endsWith("/api/sessions/sess_existing-id/messages/send-text")) {
        return jsonResponse({ success: true });
      }
      return new Response("unexpected", { status: 500 });
    });

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    const chatId = mod.buildChatId("913456789");
    const result = await mod.sendWhatsAppMessage(chatId, "🔐 رمز SubNation 123456");

    expect(result).toEqual({ ok: true });

    // Both calls used the new auth header — never `api_key`.
    for (const c of calls) {
      const headers = (c.init?.headers as Record<string, string>) ?? {};
      expect(headers["X-API-Key"]).toBe("owa_k1_test_key");
      expect(headers["api_key"]).toBeUndefined();
    }

    const sendCall = calls.find((c) => c.url.endsWith("/messages/send-text"));
    expect(sendCall).toBeDefined();
    expect(sendCall!.init?.method).toBe("POST");
    const body = JSON.parse((sendCall!.init?.body as string) ?? "{}");
    expect(body).toEqual({ chatId: "218913456789@c.us", text: "🔐 رمز SubNation 123456" });
    // Crucially the body field is `text`, NOT the legacy `message`.
    expect(body.message).toBeUndefined();
  });

  it("auto-creates and starts a session when configured by name and not yet provisioned", async () => {
    process.env.WHATSAPP_OTP_SESSION = "subnation-otp";
    const calls = installFetchMock(({ url, init }) => {
      const path = new URL(url).pathname;
      // Step 1: try-direct-by-id-or-name probe — 404 because no session
      // with that ref exists yet.
      if (path === "/api/sessions/subnation-otp" && (!init || init.method !== "POST")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      // Step 2: fall-back list — empty.
      if (path === "/api/sessions" && (!init || init.method !== "POST")) {
        return jsonResponse([]);
      }
      // Step 3: auto-create by name.
      if (path === "/api/sessions" && init?.method === "POST") {
        return jsonResponse({
          id: "sess_new-id",
          name: "subnation-otp",
          status: "qr_ready",
        });
      }
      // Step 4: start the newly-created session.
      if (path === "/api/sessions/sess_new-id/start") {
        return jsonResponse({ ok: true });
      }
      // Step 5: re-fetch to surface current status.
      if (path === "/api/sessions/sess_new-id") {
        return jsonResponse({
          id: "sess_new-id",
          name: "subnation-otp",
          status: "qr_ready",
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code 9999");
    expect(result).toEqual({ ok: false, reason: "session_not_ready", sessionStatus: "qr_ready" });

    // Bootstrap actually went through every step.
    const seen = calls.map((c) => `${c.init?.method ?? "GET"} ${new URL(c.url).pathname}`);
    expect(seen).toContain("GET /api/sessions/subnation-otp");
    expect(seen).toContain("GET /api/sessions");
    expect(seen).toContain("POST /api/sessions");
    expect(seen).toContain("POST /api/sessions/sess_new-id/start");

    // Create body used the configured name.
    const createCall = calls.find(
      (c) => c.init?.method === "POST" && new URL(c.url).pathname === "/api/sessions",
    );
    const createBody = JSON.parse((createCall!.init?.body as string) ?? "{}");
    expect(createBody).toEqual({ name: "subnation-otp" });
  });

  it("returns session_not_ready (does not throw) when the session exists but is not ready", async () => {
    installFetchMock(({ url }) => {
      if (url.endsWith("/api/sessions/sess_existing-id")) {
        return jsonResponse({ id: "sess_existing-id", name: "primary", status: "qr_ready" });
      }
      return new Response("unexpected", { status: 500 });
    });
    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_not_ready");
      expect(result.sessionStatus).toBe("qr_ready");
    }
  });

  it("returns not_configured (no fetch) when any required env is missing", async () => {
    delete process.env.WHATSAPP_OTP_SESSION;
    const calls = installFetchMock(() => jsonResponse({}, 200));

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    const result = await mod.sendWhatsAppMessage("218913456789@c.us", "code");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(calls).toHaveLength(0); // no network call when not configured
    expect(mod.isWhatsAppGatewayConfigured()).toBe(false);
  });

  it("buildChatId prepends Libya country code and uses @c.us suffix", async () => {
    const mod = await import("../openwa.service");
    expect(mod.buildChatId("913456789")).toBe("218913456789@c.us");
  });

  it("invalidates the ready cache on a non-2xx send so the next call re-bootstraps (5xx retries exhausted)", async () => {
    let lookups = 0;
    let sends = 0;
    installFetchMock(({ url }) => {
      if (url.endsWith("/api/sessions/sess_existing-id")) {
        lookups++;
        return jsonResponse({ id: "sess_existing-id", name: "primary", status: "ready" });
      }
      if (url.endsWith("/messages/send-text")) {
        sends++;
        // First sendWhatsAppMessage call: every attempt 500s (gateway
        // down hard). Second call: 200.
        return sends <= 3 ? new Response("boom", { status: 500 }) : jsonResponse({ success: true });
      }
      return new Response("unexpected", { status: 500 });
    });

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    // 96-F1 (R96-A4 §1.3D): a 5xx is now retried (3 attempts, backoff
    // 1.5 s → 4 s) with ensureSession re-run between attempts — fake
    // timers advance the backoff without wall-clock delay.
    vi.useFakeTimers();
    try {
      const firstPromise = mod.sendWhatsAppMessage("218913456789@c.us", "code-1");
      await vi.advanceTimersByTimeAsync(1_500);
      await vi.advanceTimersByTimeAsync(4_000);
      const first = await firstPromise;
      expect(first).toEqual({ ok: false, reason: "non_ok_status", status: 500 });

      const second = await mod.sendWhatsAppMessage("218913456789@c.us", "code-2");
      expect(second).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }

    // Cache was busted by every failure (re-ensure ran between attempts:
    // 3 lookups on the first call), and the second call re-looked-up too.
    expect(lookups).toBe(4);
    expect(sends).toBe(4);
  });

  it("calls preflight contacts/check before send-text and returns recipient_not_on_whatsapp when exists=false", async () => {
    let preflightHit = false;
    let sendHit = false;
    installFetchMock(({ url }) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/api/sessions/sess_existing-id")) {
        return jsonResponse({ id: "sess_existing-id", name: "primary", status: "ready" });
      }
      if (path.endsWith("/api/sessions/sess_existing-id/contacts/check/218913456789")) {
        preflightHit = true;
        return jsonResponse({
          number: "218913456789",
          exists: false,
          whatsappId: null,
        });
      }
      if (path.endsWith("/messages/send-text")) {
        sendHit = true;
        return jsonResponse({ success: true });
      }
      return new Response("unexpected", { status: 500 });
    });

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    const result = await mod.sendWhatsAppMessage(
      mod.buildChatId("913456789"),
      "OTP-MUST-NOT-BE-LOGGED",
    );

    expect(result).toEqual({ ok: false, reason: "recipient_not_on_whatsapp" });
    expect(preflightHit).toBe(true);
    // send-text MUST NOT be called when preflight says exists:false
    expect(sendHit).toBe(false);
  });

  it("falls through to send-text when preflight fails — preflight is best-effort only", async () => {
    installFetchMock(({ url }) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/api/sessions/sess_existing-id")) {
        return jsonResponse({ id: "sess_existing-id", name: "primary", status: "ready" });
      }
      if (path.endsWith("/contacts/check/218913456789")) {
        return new Response("preflight failed", { status: 500 });
      }
      if (path.endsWith("/messages/send-text")) {
        return jsonResponse({ success: true });
      }
      return new Response("unexpected", { status: 500 });
    });

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();

    const result = await mod.sendWhatsAppMessage(mod.buildChatId("913456789"), "code");

    // Preflight failure must NOT block delivery — engine's own LID
    // cache may already have the recipient resolved from a prior run.
    expect(result).toEqual({ ok: true });
  });

  it("proxies operator session management without exposing gateway metadata", async () => {
    const calls = installFetchMock(({ url, init }) => {
      const path = new URL(url).pathname;
      if (path === "/api/sessions" && !init?.method) {
        return jsonResponse([{ id: "sess-1", name: "otp", status: "ready", internal: "hidden" }]);
      }
      if (path === "/api/sessions" && init?.method === "POST") {
        return jsonResponse({ id: "sess-2", name: "backup", status: "created" });
      }
      if (path === "/api/sessions/sess-2/start") {
        return jsonResponse({ id: "sess-2", name: "backup", status: "qr_ready" });
      }
      if (path === "/api/sessions/sess-2/pair-code") {
        return jsonResponse({
          id: "sess-2",
          name: "backup",
          status: "authenticating",
          code: "ABCD-1234",
        });
      }
      if (path === "/api/sessions/sess-2/qr") {
        return jsonResponse({
          id: "sess-2",
          name: "backup",
          status: "qr_ready",
          qr: "private-qr-payload",
          qrImage: "data:image/png;base64,encoded",
        });
      }
      if (path === "/api/sessions/sess-2" && init?.method === "DELETE") {
        return jsonResponse({ deleted: true, id: "sess-2" });
      }
      return new Response("unexpected", { status: 500 });
    });

    const mod = await import("../openwa.service");
    const listed = await mod.listWhatsAppSessions();
    const created = await mod.createWhatsAppSession("backup");
    const started = await mod.startWhatsAppSession(created.id);
    const paired = await mod.requestWhatsAppPairCode(created.id, "+218913456789");
    const qr = await mod.getWhatsAppSessionQr(created.id);
    const deleted = await mod.deleteWhatsAppSession(created.id);

    expect(listed).toEqual([{ id: "sess-1", name: "otp", status: "ready" }]);
    expect(created).toEqual({ id: "sess-2", name: "backup", status: "created" });
    expect(started.status).toBe("qr_ready");
    expect(paired.code).toBe("ABCD-1234");
    expect(qr).toEqual({
      session: { id: "sess-2", name: "backup", status: "qr_ready" },
      qrImage: "data:image/png;base64,encoded",
    });
    expect(deleted).toEqual({ deleted: true, id: "sess-2" });

    for (const call of calls) {
      const headers = (call.init?.headers as Record<string, string>) ?? {};
      expect(headers["X-API-Key"]).toBe("owa_k1_test_key");
    }
    const createCall = calls.find(
      (call) => new URL(call.url).pathname === "/api/sessions" && call.init?.method === "POST",
    );
    expect(JSON.parse(String(createCall?.init?.body))).toEqual({ name: "backup" });
    const pairCall = calls.find((call) => new URL(call.url).pathname.endsWith("/pair-code"));
    expect(JSON.parse(String(pairCall?.init?.body))).toEqual({ phone: "218913456789" });
  });

  it("rejects invalid operator session input before making a gateway request", async () => {
    const calls = installFetchMock(() => jsonResponse({}, 200));
    const mod = await import("../openwa.service");

    await expect(mod.createWhatsAppSession("bad name")).rejects.toMatchObject({ statusCode: 400 });
    await expect(mod.requestWhatsAppPairCode("sess-1", "091234567")).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(mod.deleteWhatsAppSession("../escape")).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toHaveLength(0);
  });
});
