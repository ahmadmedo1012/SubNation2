/**
 * r95 — WhatsApp honesty surface.
 *
 * Covers the two pieces added in round 95:
 *   1. `getWhatsAppGatewayReadiness` — cached probe of the configured
 *      OpenWA session: `ready` ONLY for status==="ready", null status
 *      on gateway errors, 30s cache behavior, `configured:false` when
 *      env is missing.
 *   2. `startOtp` mapping — a `session_not_ready` send failure now
 *      surfaces as the DISTINCT `whatsapp_not_paired` reason (honest
 *      "channel is being repaired" copy) instead of the misleading
 *      `gateway_disabled`.
 *
 * Fetch is mocked at the module boundary; the DB layer is mocked so
 * the rate-limit probes return an empty recent-OTP list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.WHATSAPP_OTP_BASE_URL = "http://openwa.test";
  process.env.WHATSAPP_OTP_API_KEY = "owa_k1_test_key";
  process.env.WHATSAPP_OTP_SESSION = "subnation-otp";
  // 96-F1 (R96-A4 §1.3A): these tests pin the pairing-status honesty of
  // the probe. Settle=0 + no operator number keeps them semantics-focused
  // (ready ⇔ status==="ready"); the settle/warm-up gating itself has
  // dedicated coverage in openwa-settle-gate.test.ts.
  process.env.WHATSAPP_OTP_SETTLE_MS = "0";
  delete process.env.WHATSAPP_OTP_OPERATOR_E164;
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("getWhatsAppGatewayReadiness", () => {
  it("reports ready:true only when the configured session is ready", async () => {
    installFetchMock((url) => {
      if (url.endsWith("/api/sessions/subnation-otp")) {
        return jsonResponse({ id: "sess_1", name: "subnation-otp", status: "ready" });
      }
      return jsonResponse([{ id: "sess_1", name: "subnation-otp", status: "ready" }]);
    });
    const mod = await import("../openwa.service");
    mod.__resetWhatsAppReadinessCacheForTests();
    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({ configured: true, ready: true, status: "ready" });
  });

  it("reports ready:false with the live status for an unpaired session (qr_ready)", async () => {
    installFetchMock((url) => {
      if (url.endsWith("/api/sessions/subnation-otp")) {
        return jsonResponse({ id: "sess_1", name: "subnation-otp", status: "qr_ready" });
      }
      return jsonResponse([{ id: "sess_1", name: "subnation-otp", status: "qr_ready" }]);
    });
    const mod = await import("../openwa.service");
    mod.__resetWhatsAppReadinessCacheForTests();
    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({ configured: true, ready: false, status: "qr_ready" });
  });

  it("never fabricates ready — gateway unreachable yields status null", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const mod = await import("../openwa.service");
    mod.__resetWhatsAppReadinessCacheForTests();
    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({ configured: true, ready: false, status: null });
  });

  it("caches the probe result for the TTL window", async () => {
    let hits = 0;
    installFetchMock((url) => {
      hits += 1;
      if (url.endsWith("/api/sessions/subnation-otp")) {
        return jsonResponse({ id: "sess_1", name: "subnation-otp", status: "ready" });
      }
      return jsonResponse([{ id: "sess_1", name: "subnation-otp", status: "ready" }]);
    });
    const mod = await import("../openwa.service");
    mod.__resetWhatsAppReadinessCacheForTests();
    await mod.getWhatsAppGatewayReadiness();
    await mod.getWhatsAppGatewayReadiness();
    await mod.getWhatsAppGatewayReadiness();
    // One session lookup (single fetch inside findSession when the id
    // path resolves) shared across all three calls within the cache.
    expect(hits).toBe(1);
  });

  it("reports configured:false when env is missing", async () => {
    delete process.env.WHATSAPP_OTP_BASE_URL;
    const mod = await import("../openwa.service");
    mod.__resetWhatsAppReadinessCacheForTests();
    const r = await mod.getWhatsAppGatewayReadiness();
    expect(r).toMatchObject({ configured: false, ready: false, status: null });
  });
});

describe("startOtp — session_not_ready maps to whatsapp_not_paired", () => {
  it("returns the distinct whatsapp_not_paired reason (not gateway_disabled)", async () => {
    vi.doMock("@workspace/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      },
      referralEventsTable: {},
      usersTable: {},
      whatsappOtpsTable: {},
    }));

    installFetchMock((url) => {
      if (url.endsWith("/api/sessions/subnation-otp")) {
        return jsonResponse({ id: "sess_1", name: "subnation-otp", status: "qr_ready" });
      }
      return jsonResponse([{ id: "sess_1", name: "subnation-otp", status: "qr_ready" }]);
    });

    const mod = await import("../openwa.service");
    mod.__resetWhatsAppGatewayCacheForTests();
    const svc = await import("../whatsapp-otp.service");

    const result = await svc.startOtp({
      rawPhone: "0913456789",
      purpose: "registration",
    });

    expect(result).toEqual({ ok: false, reason: "whatsapp_not_paired" });
  });

  // B5-2 (R111): the FULL openwa.service → whatsapp-otp.service chain —
  // a session in a BOOT state (initializing/created) during the gateway's
  // 3-25 s cold-boot window rides the R102 gateway_waking contract (503
  // + Retry-After 30 + FE auto-retry) instead of the scary not-paired
  // copy. This is the chain test for the taxonomy pinned (transport
  // mocked) in whatsapp-otp-gateway-waking.test.ts.
  it.each(["initializing", "created"])(
    "session %s during gateway cold-boot maps to gateway_waking + retryAfterSec 30 (B5-2)",
    async (sessionStatus) => {
      vi.doMock("@workspace/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        },
        referralEventsTable: {},
        usersTable: {},
        whatsappOtpsTable: {},
      }));

      installFetchMock((url) => {
        // ensureSession resolves the session (and nudges a `created`
        // one via POST /start — any 2xx shape satisfies the nudge).
        if (url.endsWith("/api/sessions/subnation-otp")) {
          return jsonResponse({ id: "sess_1", name: "subnation-otp", status: sessionStatus });
        }
        return jsonResponse({ ok: true });
      });

      const mod = await import("../openwa.service");
      mod.__resetWhatsAppGatewayCacheForTests();
      const svc = await import("../whatsapp-otp.service");

      const result = await svc.startOtp({
        rawPhone: "0913456789",
        purpose: "registration",
      });

      expect(result).toEqual({ ok: false, reason: "gateway_waking", retryAfterSec: 30 });
    },
  );
});
