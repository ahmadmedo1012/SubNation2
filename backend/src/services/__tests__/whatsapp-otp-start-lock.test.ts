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
 *
 * R118-B1b additions:
 *   5. F-4: a never-answering unlock query is bounded by the unlock
 *      race (env-overridable OTP_UNLOCK_TIMEOUT_MS) → destroy path
 *      within the bound, no hang, no unhandled rejection.
 *   6. F-5: unlock failure raises the deduped "otp:lockpool" admin alert.
 *   7. F-5: pool saturation raises the deduped "otp:lockpool:saturation"
 *      admin alert.
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

/** F-4 (R118-A1): the dead-connection shape — the unlock query NEVER
 * settles (no resolve, no reject), exactly what a silently-dropped TCP
 * path looks like to a pooled pg client with no statement timeout. */
function makeHangingUnlockClient() {
  const calls: string[] = [];
  const client = {
    query: vi.fn((text: string): Promise<
      { rows: { acquired: boolean }[] } | { rows: { unlocked: boolean }[] }
    > => {
      if (text.includes("pg_try_advisory_lock")) {
        calls.push("try_lock");
        return Promise.resolve({ rows: [{ acquired: true }] });
      }
      if (text.includes("pg_advisory_unlock")) {
        calls.push("unlock");
        return new Promise(() => {});
      }
      calls.push("query:" + text.slice(0, 24));
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn((destroy?: boolean) => {
      calls.push(destroy === true ? "release_destroy" : "release");
    }),
    calls,
  };
  return client;
}

function mockOpenwaBoundary() {
  return {
    sendWhatsAppMessage: vi.fn(async () => ({ ok: true })),
    buildChatId: vi.fn((phone: string) => `${phone}@c.us`),
    getGatewayStatus: vi.fn(() => ({ configured: true, ready: true })),
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
  vi.doUnmock("../../jobs/alertLogger");
  delete process.env.OTP_UNLOCK_TIMEOUT_MS;
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

describe("OTP start-lock unlock race + admin alerts (R118-B1b: A1 F-4/F-5)", () => {
  it("F-4: a never-answering unlock query is bounded — destroy path taken within the timeout, no hang, no unhandled rejection", async () => {
    // Shrink the race window so the test proves the TIMER settles the
    // race (the default is 5 s; without the fix this await would hang
    // until TCP keepalives — the vitest timeout would kill the test).
    process.env.OTP_UNLOCK_TIMEOUT_MS = "25";
    const client = makeHangingUnlockClient();
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary());
    const service = await importService();
    service.__setOtpStartLockPoolForTests(makeFakePool(client));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const startedAt = Date.now();
    try {
      const result = await service.startOtp({
        rawPhone: "0910000005",
        ipAddress: "1.2.3.4",
        userAgent: "test",
      } as never);
      const elapsed = Date.now() - startedAt;

      // The send already succeeded — an unlock pathology must not fail
      // the start (same contract as the R117 unlock-failure branch).
      expect(result.ok).toBe(true);
      // The timeout took the unlockOk=false path: destroy, not plain release.
      expect(client.calls[client.calls.length - 1]).toBe("release_destroy");
      expect(client.release).toHaveBeenCalledWith(true);
      // Bounded by the race window — the timer fired (≥ the window) and
      // the request did NOT hang (well under any keepalive horizon).
      expect(elapsed).toBeGreaterThanOrEqual(20);
      expect(elapsed).toBeLessThan(2_000);

      // Let stray microtasks settle — the still-pending unlock query
      // promise must never surface as an unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("F-5: unlock failure raises the deduped otp:lockpool admin alert", async () => {
    const alertSpy = vi.fn(
      async (
        _type: string,
        _title: string,
        _message: string,
        _opts?: { dedupeKey?: string },
      ) => ({ suppressed: false, id: 1 }),
    );
    const client = makeFakeClient({ unlockFails: true });
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary());
    vi.doMock("../../jobs/alertLogger", () => ({ logAdminAlert: alertSpy }));
    const service = await importService();
    service.__setOtpStartLockPoolForTests(makeFakePool(client));

    const result = await service.startOtp({
      rawPhone: "0910000006",
      ipAddress: "1.2.3.4",
      userAgent: "test",
    } as never);

    expect(result.ok).toBe(true);
    expect(client.release).toHaveBeenCalledWith(true);
    // The alert dispatch rides a dynamic import — wait for it to land.
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    const [type, title, message, opts] = alertSpy.mock.calls[0];
    expect(type).toBe("system");
    expect(typeof title).toBe("string");
    expect(typeof message).toBe("string");
    expect(opts).toMatchObject({ dedupeKey: "otp:lockpool" });
  });

  it("F-5: pool saturation raises the deduped otp:lockpool:saturation admin alert", async () => {
    const alertSpy = vi.fn(
      async (
        _type: string,
        _title: string,
        _message: string,
        _opts?: { dedupeKey?: string },
      ) => ({ suppressed: false, id: 1 }),
    );
    vi.doMock("@workspace/db", () => mockDbBoundary());
    vi.doMock("../openwa.service", () => mockOpenwaBoundary());
    vi.doMock("../../jobs/alertLogger", () => ({ logAdminAlert: alertSpy }));
    const service = await importService();
    service.__setOtpStartLockPoolForTests(
      makeFakePool(makeFakeClient(), new Error("timeout exceeded when trying to connect")),
    );

    const result = await service.startOtp({
      rawPhone: "0910000007",
      ipAddress: "1.2.3.4",
      userAgent: "test",
    } as never);

    expect(result).toEqual({ ok: false, reason: "cooldown", retryAfterSec: 15 });
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    const [type, , , opts] = alertSpy.mock.calls[0];
    expect(type).toBe("system");
    expect(opts).toMatchObject({ dedupeKey: "otp:lockpool:saturation" });
  });
});
