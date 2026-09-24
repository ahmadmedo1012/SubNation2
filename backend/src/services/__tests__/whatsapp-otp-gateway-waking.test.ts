/**
 * AUD103-5-F3 / AUD103-8-F4 (r103, P1) — service half of the R102 cold-wake
 * contract: the send-failure taxonomy inside startOtp must classify
 * RETRYABLE wire failures (request_failed / 5xx) as `gateway_waking` with
 * retryAfterSec: 30, while 4xx rejections stay `delivery_failed` (NOT a
 * wake shape). Same vi.doMock pattern as whatsapp-otp-start-hygiene.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

function emptyRecentOtpsDb() {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn(),
    },
    referralEventsTable: {},
    usersTable: {},
    whatsappOtpsTable: {},
  };
}

beforeEach(() => {
  process.env.WHATSAPP_OTP_BASE_URL = "http://openwa.test";
  process.env.WHATSAPP_OTP_API_KEY = "owa_k1_test_key";
  process.env.WHATSAPP_OTP_SESSION = "subnation-otp";
  process.env.WHATSAPP_OTP_SETTLE_MS = "0";
  delete process.env.WHATSAPP_OTP_OPERATOR_E164;
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock("@workspace/db");
  vi.doUnmock("../openwa.service");
});

describe("startOtp — gateway cold-wake taxonomy (R102, pinned r103)", () => {
  it("request_failed (network/timeout exhaustion) → gateway_waking + retryAfterSec 30", async () => {
    const sendWhatsAppMessage = vi.fn().mockResolvedValue({
      ok: false,
      reason: "request_failed",
    });
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage,
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    expect(result).toEqual({ ok: false, reason: "gateway_waking", retryAfterSec: 30 });
  });

  it("non_ok_status with a 5xx gateway response → gateway_waking + retryAfterSec 30", async () => {
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage: vi.fn().mockResolvedValue({
        ok: false,
        reason: "non_ok_status",
        status: 503,
      }),
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    expect(result).toEqual({ ok: false, reason: "gateway_waking", retryAfterSec: 30 });
  });

  it("non_ok_status with a 4xx gateway response stays delivery_failed (NOT a wake shape, no Retry-After)", async () => {
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage: vi.fn().mockResolvedValue({
        ok: false,
        reason: "non_ok_status",
        status: 400,
      }),
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    expect(result).toEqual({ ok: false, reason: "delivery_failed" });
  });
});

// ─── B5-2 (R111): gateway cold-boot honesty — initializing/created ride the
// gateway_waking verdict instead of the scary whatsapp_not_paired copy ────────

describe("startOtp — session boot states map to gateway_waking (B5-2, pinned R111)", () => {
  it.each(["initializing", "created"])(
    "session_not_ready with sessionStatus %s (gateway cold-boot window) → gateway_waking + retryAfterSec 30",
    async (sessionStatus) => {
      vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
      vi.doMock("../openwa.service", () => ({
        buildChatId: (phone: string) => `218${phone}@c.us`,
        sendWhatsAppMessage: vi.fn().mockResolvedValue({
          ok: false,
          reason: "session_not_ready",
          sessionStatus,
        }),
      }));

      const svc = await import("../whatsapp-otp.service");
      const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

      // The R102 cold-wake contract (503 + Retry-After 30 + the frontend
      // auto-retry) — NOT the r95 whatsapp_not_paired copy that turned a
      // routine 3-25 s gateway boot into a manual re-tap.
      expect(result).toEqual({ ok: false, reason: "gateway_waking", retryAfterSec: 30 });
    },
  );

  it.each(["qr_ready", "disconnected", "failed", "authenticating"])(
    "session_not_ready with sessionStatus %s stays whatsapp_not_paired (r95 honesty, no Retry-After)",
    async (sessionStatus) => {
      vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
      vi.doMock("../openwa.service", () => ({
        buildChatId: (phone: string) => `218${phone}@c.us`,
        sendWhatsAppMessage: vi.fn().mockResolvedValue({
          ok: false,
          reason: "session_not_ready",
          sessionStatus,
        }),
      }));

      const svc = await import("../whatsapp-otp.service");
      const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

      // A real operator action (re-pair / QR scan) is pending — keep the
      // honest not-paired verdict; authenticating rides with qr_ready
      // (an operator scan is in progress, not a service boot).
      expect(result).toEqual({ ok: false, reason: "whatsapp_not_paired" });
    },
  );

  it("non_ok_status 409 (mid-send session flap, retries exhausted) → gateway_waking + retryAfterSec 30 (B5-4)", async () => {
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage: vi.fn().mockResolvedValue({
        ok: false,
        reason: "non_ok_status",
        status: 409,
      }),
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    // The gateway's session_not_ready-at-send-time flap is a WAKE shape,
    // not a hard 502 — the frontend's auto-retry rides it.
    expect(result).toEqual({ ok: false, reason: "gateway_waking", retryAfterSec: 30 });
  });
});
