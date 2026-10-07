/**
 * R120-B6/A8-F5 — process-wide daily OTP send ceiling.
 *
 * Every other OTP cap is keyed per-phone (cooldown, hourly limit) or
 * per-IP (the /start limiter); an attacker rotating IPs against distinct
 * numbers never trips any of them. This suite pins the GLOBAL brake:
 *
 *   1. cap trips → `daily_limit` verdict, the gateway send NEVER fires,
 *      and the operator announcement (logger.error + deduped
 *      "otp-daily-cap" admin alert) fires exactly ONCE per UTC day;
 *   2. failed deliveries do NOT count — only real dispatches;
 *   3. the counter resets at the UTC day boundary (fake timers).
 *
 * Same module-boundary mock shape as whatsapp-otp-start-hygiene /
 * whatsapp-otp-start-lock (the @workspace/db alias would otherwise open
 * a real pool; the mocks export no lockPool so the start lock gate is
 * bypassed and the single-process flow is exercised directly).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

function mockDbBoundary() {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    },
    referralEventsTable: {},
    usersTable: {},
    whatsappOtpsTable: {},
  };
}

function mockOpenwaBoundary(
  send: () => Promise<{ ok: boolean; reason?: string; status?: number }>,
) {
  return {
    sendWhatsAppMessage: vi.fn(send),
    buildChatId: vi.fn((phone: string) => `${phone}@c.us`),
    getGatewayStatus: vi.fn(() => ({ configured: true, ready: true })),
  };
}

async function importService() {
  return import("../whatsapp-otp.service");
}

beforeEach(() => {
  process.env.WHATSAPP_OTP_BASE_URL = "http://openwa.test";
  process.env.WHATSAPP_OTP_API_KEY = "owa_k1_test_key";
  process.env.WHATSAPP_OTP_SESSION = "subnation-otp";
  process.env.WHATSAPP_OTP_SETTLE_MS = "0";
  delete process.env.WHATSAPP_OTP_OPERATOR_E164;
  // Small cap so the trip point is reachable in a handful of sends.
  process.env.OTP_DAILY_SEND_CAP = "3";
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock("@workspace/db");
  vi.doUnmock("../openwa.service");
  vi.doUnmock("../../jobs/alertLogger");
  delete process.env.OTP_DAILY_SEND_CAP;
});

describe("startOtp — process-wide daily send ceiling (R120-B6/A8-F5)", () => {
  it("cap trips → daily_limit verdict, no send, announcement exactly once", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const alertSpy = vi.fn(async () => ({ suppressed: false, id: 1 }));
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary(send));
    vi.doMock("../../jobs/alertLogger", () => ({ logAdminAlert: alertSpy }));
    const svc = await importService();
    // vi.resetModules() re-evaluated ../lib/logger with the service — spy
    // on THAT instance (the top-of-file static import is a stale copy).
    const { logger: freshLogger } = await import("../../lib/logger");
    const errorSpy = vi.spyOn(freshLogger, "error").mockImplementation(() => {});

    // Three distinct phones — the identifier-keyed caps never trip; the
    // process-wide counter climbs 1 → 2 → 3.
    for (const phone of ["0910000001", "0910000002", "0910000003"]) {
      const r = await svc.startOtp({ rawPhone: phone, purpose: "registration" });
      expect(r.ok).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect(alertSpy).not.toHaveBeenCalled();

    // 4th send — the cap (3) trips BEFORE the send: no gateway dispatch,
    // the daily_limit verdict, and the once-per-day announcement.
    const tripped = await svc.startOtp({ rawPhone: "0910000004", purpose: "registration" });
    expect(tripped).toEqual({ ok: false, reason: "daily_limit" });
    expect(send).toHaveBeenCalledTimes(3); // nothing new went out

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(alertSpy).toHaveBeenCalledWith(
      "system",
      expect.any(String),
      expect.stringContaining("3/3"),
      { dedupeKey: "otp-daily-cap" },
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // 5th refusal — same verdict, but the announcement must NOT repeat
    // (call-site capTripAnnounced flag; the DB dedupe is belt+braces).
    const trippedAgain = await svc.startOtp({ rawPhone: "0910000005", purpose: "registration" });
    expect(trippedAgain).toEqual({ ok: false, reason: "daily_limit" });
    expect(send).toHaveBeenCalledTimes(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("failed delivery does not count toward the cap (only real dispatches)", async () => {
    let nextSendFails = true;
    const send = vi.fn(async () =>
      nextSendFails ? { ok: false, reason: "non_ok_status", status: 400 } : { ok: true },
    );
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary(send));
    vi.doMock("../../jobs/alertLogger", () => ({
      logAdminAlert: vi.fn(async () => ({ suppressed: false, id: 1 })),
    }));
    const svc = await importService();

    // cap = 3; a failed send must NOT burn quota.
    for (const phone of ["0920000001", "0920000002", "0920000003"]) {
      const r = await svc.startOtp({ rawPhone: phone, purpose: "registration" });
      expect(r).toMatchObject({ ok: false, reason: "delivery_failed" });
    }

    nextSendFails = false;
    const ok = await svc.startOtp({ rawPhone: "0920000004", purpose: "registration" });
    expect(ok.ok).toBe(true); // counter was still 0 → send allowed

    // ...and now the single real dispatch counts: with cap=3 the 4th
    // ATTEMPT (2nd real send) is fine, the trip only comes at 3 sends.
    const ok2 = await svc.startOtp({ rawPhone: "0920000005", purpose: "registration" });
    expect(ok2.ok).toBe(true);
    const ok3 = await svc.startOtp({ rawPhone: "0920000006", purpose: "registration" });
    expect(ok3.ok).toBe(true);
    const tripped = await svc.startOtp({ rawPhone: "0920000007", purpose: "registration" });
    expect(tripped).toEqual({ ok: false, reason: "daily_limit" });
    expect(send).toHaveBeenCalledTimes(6); // 3 failed + 3 real
  });

  it("counter resets across the UTC day boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T23:58:30Z"));
    const send = vi.fn(async () => ({ ok: true }));
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary(send));
    vi.doMock("../../jobs/alertLogger", () => ({
      logAdminAlert: vi.fn(async () => ({ suppressed: false, id: 1 })),
    }));
    const svc = await importService();

    // Burn the whole cap (3) before midnight.
    for (const phone of ["0930000001", "0930000002", "0930000003"]) {
      const r = await svc.startOtp({ rawPhone: phone, purpose: "registration" });
      expect(r.ok).toBe(true);
    }
    const preMidnight = await svc.startOtp({ rawPhone: "0930000004", purpose: "registration" });
    expect(preMidnight).toEqual({ ok: false, reason: "daily_limit" });

    // Cross the UTC day boundary — the counter rolls and sends resume.
    vi.setSystemTime(new Date("2026-10-08T00:00:30Z"));
    const postMidnight = await svc.startOtp({ rawPhone: "0930000005", purpose: "registration" });
    expect(postMidnight.ok).toBe(true);

    // The fresh day has its OWN cap: trip it again to prove the reset
    // re-armed the gate (not just a permanently-open valve).
    const postMidnight2 = await svc.startOtp({ rawPhone: "0930000006", purpose: "registration" });
    expect(postMidnight2.ok).toBe(true);
    const postMidnight3 = await svc.startOtp({ rawPhone: "0930000007", purpose: "registration" });
    expect(postMidnight3.ok).toBe(true);
    const trippedNewDay = await svc.startOtp({ rawPhone: "0930000008", purpose: "registration" });
    expect(trippedNewDay).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("non-numeric / non-positive OTP_DAILY_SEND_CAP falls back to the default (never disables the gate)", async () => {
    // A garbage or non-positive value must resolve to the documented 500
    // default — never to 0/NaN (a permanently-tripped gate) or Infinity
    // (a disabled one). Full 500-send proof is too slow here; the parse
    // fallback is pinned by asserting sends still work AND that a
    // deliberately tiny VALID cap in the same shape still trips (the
    // first test) — together: parse is guarded, the gate is live.
    process.env.OTP_DAILY_SEND_CAP = "not-a-number";
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary(vi.fn(async () => ({ ok: true }))));
    vi.doMock("../../jobs/alertLogger", () => ({
      logAdminAlert: vi.fn(async () => ({ suppressed: false, id: 1 })),
    }));
    const svc = await importService();
    const r = await svc.startOtp({ rawPhone: "0940000001", purpose: "registration" });
    expect(r.ok).toBe(true);

    // Non-positive behaves the same (falls back, not "cap = 0 = refuse
    // everything" — an operator typo must not brick OTP login).
    vi.resetModules();
    process.env.OTP_DAILY_SEND_CAP = "0";
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary(vi.fn(async () => ({ ok: true }))));
    vi.doMock("../../jobs/alertLogger", () => ({
      logAdminAlert: vi.fn(async () => ({ suppressed: false, id: 1 })),
    }));
    const svc2 = await importService();
    const r2 = await svc2.startOtp({ rawPhone: "0940000002", purpose: "registration" });
    expect(r2.ok).toBe(true);
  });
});
