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
