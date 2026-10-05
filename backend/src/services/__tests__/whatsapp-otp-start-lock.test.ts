/**
 * R117 (A1-P2 + A1-P3) — OTP start-lock regression suite.
 *
 * The lock path (withPhoneStartLock) is bypassed by the module-boundary
 * mocks (they export no lockPool), so before R117 it had ZERO coverage:
 * both the runtime-pool starvation bug and the unlock-leak class would
 * have shipped silently. These tests exercise the gate through the
 * __setOtpStartLockPoolForTests seam with a scripted fake pool/client.
 *
 * Cases:
 *   1. Happy path: acquire → send → insert → unlock → release(false).
 *   2. Lock loser: acquire fails → cooldown verdict → NO unlock, plain
 *      release(false), send never happens.
 *   3. Unlock failure: destroy the client (release(true)) so Postgres
 *      drops the session-scoped lock — the leak fix.
 *   4. Pool saturation: connect() rejects → busy verdict (never throws).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.fetch;

function makeFakeClient({
  acquired = true,
  unlockFails = false,
}: { acquired?: boolean; unlockFails?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      if (text.includes("pg_try_advisory_lock")) {
        calls.push("try_lock");
        return { rows: [{ acquired }] };
      }
      if (text.includes("pg_advisory_unlock")) {
        calls.push("unlock");
        if (unlockFails) throw new Error("statement timeout");
        return { rows: [{ unlocked: true }] };
      }
      calls.push("query:" + text.slice(0, 24));
      return { rows: [] };
    }),
    release: vi.fn((destroy?: boolean) => {
      calls.push(destroy === true ? "release_destroy" : "release");
    }),
    calls,
  };
  return client;
}

function makeFakePool(client: ReturnType<typeof makeFakeClient>, connectErr?: Error) {
  return {
    connect: vi.fn(async () => {
      if (connectErr) throw connectErr;
      return client;
    }),
  };
}

function mockDbBoundary(recentOtps: Array<{ createdAt: Date }> = []) {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(recentOtps),
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

async function importService() {
  const mod = await import("../whatsapp-otp.service");
  return mod;
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

describe("OTP start-lock gate (R117 A1-P2/A1-P3)", () => {
  it("happy path: acquire → send → insert → unlock → plain release", async () => {
    const client = makeFakeClient();
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => ({
      sendWhatsAppMessage: vi.fn(async () => ({ ok: true })),
      buildChatId: vi.fn((phone: string) => `${phone}@c.us`),
      getGatewayStatus: vi.fn(() => ({ configured: true, ready: true })),
    }));
    const service = await importService();
    const pool = makeFakePool(client);
    service.__setOtpStartLockPoolForTests(pool);

    const result = await service.startOtp({
      rawPhone: "0910000001",
      ipAddress: "1.2.3.4",
      userAgent: "test",
    } as never);

    expect(result.ok).toBe(true);
    // Order: lock acquired before any send, unlocked, then plain release.
    expect(client.calls[0]).toBe("try_lock");
    expect(client.calls).toContain("unlock");
    expect(client.calls[client.calls.length - 1]).toBe("release");
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("lock loser: cooldown verdict, no unlock, send never happens", async () => {
    const client = makeFakeClient({ acquired: false });
    const dbBoundary = mockDbBoundary();
    const sendMock = vi.fn(async () => ({ ok: true }));
    vi.doMock("@workspace/db", () => dbBoundary);
    vi.doMock("../openwa.service", () => ({
      sendWhatsAppMessage: sendMock,
      buildChatId: vi.fn((phone: string) => `${phone}@c.us`),
      getGatewayStatus: vi.fn(() => ({ configured: true, ready: true })),
    }));
    const service = await importService();
    service.__setOtpStartLockPoolForTests(makeFakePool(client));

    const result = await service.startOtp({
      rawPhone: "0910000002",
      ipAddress: "1.2.3.4",
      userAgent: "test",
    } as never);

    expect(result).toEqual({ ok: false, reason: "cooldown", retryAfterSec: 15 });
    expect(client.calls).toEqual(["try_lock", "release"]); // no unlock for a lock we never held
    expect(sendMock).not.toHaveBeenCalled();
    // The loser must NOT probe the DB cooldown either (the winner's row
    // backs the real verdict on retry) — the db boundary stays untouched.
    expect(dbBoundary.db.select).not.toHaveBeenCalled();
  });

  it("unlock failure destroys the client so the session lock drops server-side", async () => {
    const client = makeFakeClient({ unlockFails: true });
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => ({
      sendWhatsAppMessage: vi.fn(async () => ({ ok: true })),
      buildChatId: vi.fn((phone: string) => `${phone}@c.us`),
      getGatewayStatus: vi.fn(() => ({ configured: true, ready: true })),
    }));
    const service = await importService();
    service.__setOtpStartLockPoolForTests(makeFakePool(client));

    const result = await service.startOtp({
      rawPhone: "0910000003",
      ipAddress: "1.2.3.4",
      userAgent: "test",
    } as never);

    expect(result.ok).toBe(true);
    expect(client.calls[client.calls.length - 1]).toBe("release_destroy");
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("lock-pool saturation answers the busy verdict instead of throwing", async () => {
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => ({
      sendWhatsAppMessage: vi.fn(async () => ({ ok: true })),
      buildChatId: vi.fn((phone: string) => `${phone}@c.us`),
      getGatewayStatus: vi.fn(() => ({ configured: true, ready: true })),
    }));
    const service = await importService();
    service.__setOtpStartLockPoolForTests(
      makeFakePool(makeFakeClient(), new Error("timeout exceeded when trying to connect")),
    );

    const result = await service.startOtp({
      rawPhone: "0910000004",
      ipAddress: "1.2.3.4",
      userAgent: "test",
    } as never);

    expect(result).toEqual({ ok: false, reason: "cooldown", retryAfterSec: 15 });
  });
});
