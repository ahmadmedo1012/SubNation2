/**
 * 96-F1 (R96-A4 §1.3C + §4.2) — startOtp orchestration hygiene:
 *
 *   1. `session_settling` from the OpenWA settle gate maps to the DISTINCT
 *      `whatsapp_settling` reason with retryAfterSec = ceil(readyInMs/1000)
 *      (the route turns that into 503 + Retry-After).
 *
 *   2. The OTP row insert (which happens AFTER the WhatsApp message is
 *      already on the user's phone) is retried ONCE on a DB blip — a
 *      transient failure must not strand a delivered code with no row.
 *
 *   3. When both insert attempts fail, the verdict is `store_failed` with
 *      retryAfterSec: 30 — the client then applies a short cooldown
 *      instead of instantly re-sending a SECOND WhatsApp message while
 *      the first code is still valid and readable.
 *
 * The OpenWA transport and the DB are mocked at the module boundary
 * (same vi.doMock pattern as whatsapp-readiness.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

function emptyRecentOtpsDb(overrides: Partial<Record<"insert", ReturnType<typeof vi.fn>>> = {}) {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: overrides.insert ?? vi.fn(),
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

describe("startOtp — settle-gate + insert-retry orchestration (96-F1)", () => {
  it("session_settling maps to whatsapp_settling with retryAfterSec = ceil(readyInMs/1000)", async () => {
    const sendWhatsAppMessage = vi.fn().mockResolvedValue({
      ok: false,
      reason: "session_settling",
      readyInMs: 12_400,
    });
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage,
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    expect(result).toEqual({ ok: false, reason: "whatsapp_settling", retryAfterSec: 13 });
    // The OTP was never dispatched (gate refused before the send-text).
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
  });

  it("session_settling with sub-second remaining still reports ≥ 1 s retry", async () => {
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb());
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage: vi.fn().mockResolvedValue({
        ok: false,
        reason: "session_settling",
        readyInMs: 400,
      }),
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });
    expect(result).toMatchObject({ ok: false, reason: "whatsapp_settling", retryAfterSec: 1 });
  });

  it("insert retried once on a DB blip — the delivered code still lands its row", async () => {
    const insert = vi
      .fn()
      .mockReturnValueOnce({ values: vi.fn().mockRejectedValue(new Error("db blip")) })
      .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb({ insert }));
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage: vi.fn().mockResolvedValue({ ok: true }),
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("insert failing twice → store_failed + retryAfterSec 30 (short client cooldown)", async () => {
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("db down")),
    });
    vi.doMock("@workspace/db", () => emptyRecentOtpsDb({ insert }));
    const sendWhatsAppMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("../openwa.service", () => ({
      buildChatId: (phone: string) => `218${phone}@c.us`,
      sendWhatsAppMessage,
    }));

    const svc = await import("../whatsapp-otp.service");
    const result = await svc.startOtp({ rawPhone: "0913456789", purpose: "registration" });

    expect(result).toEqual({ ok: false, reason: "store_failed", retryAfterSec: 30 });
    // Exactly one WhatsApp message went out (retry-once is on the INSERT,
    // never on the send — a second message is exactly what we avoid).
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
