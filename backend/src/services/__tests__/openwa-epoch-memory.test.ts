import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { getRedisClient } from "../../lib/redis-client";

/**
 * R104 (AG4-2) / RT-3 (red team) — the Neon-persisted pairing-epoch
 * marker, exercised END-TO-END through the REAL store (pglite harness)
 * and the REAL recordReadySince adoption branch.
 *
 * Production problem being pinned: the Render free tier sleeps the
 * backend after 15 idle minutes; the gateway rewrites `lastReadyAt` on
 * every connection open, so a routine boot-restore looked like a
 * re-pair and re-armed the full 45 s settle + warm-up ceremony on every
 * wake (~75-80 s first-OTP latency, the DOMINANT case in low traffic).
 *
 * The fix: (a) the gateway exposes a STABLE pairingId
 * (creds.registrationId — survives restores, changes only on re-pair);
 * (b) the backend keys the epoch on it; (c) the epoch's
 * ready-since/warmed state is mirrored into system_settings so a cold
 * process ADOPTS the proven state when the SAME pairingId returns.
 *
 * These tests pin (fetch mocked at the module boundary; redis null =
 * the no-Redis production shape; the epoch store is the REAL module
 * against pglite):
 *
 *   1. first ready observation (no marker) → fresh full window +
 *      marker persisted {epoch, readySince, warmed:false};
 *   2. cold process + SAME pairingId → ADOPTED: only the 5 s residual
 *      settle remains (not 45 s) — the wake-ceremony elimination;
 *   3. cold process + CHANGED pairingId (true re-pair) → full fresh
 *      45 s window + marker overwritten;
 *   4. marker warmed:true → dispatch gate adopted (no warm-up
 *      self-message re-send after a restore);
 *   5. WHATSAPP_OTP_DISABLE_EPOCH_MEMORY=true → no adoption (fresh
 *      45 s window — the operator kill switch);
 *   6. operator number set + warmed marker → NO warm-up send-text is
 *      issued on the restored epoch (the self-message elimination).
 */

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(() => null),
  withRedisCommandTimeout: <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const ORIGINAL_FETCH = globalThis.fetch;
const SESSION_ID = "sess_epoch_1";
const SESSION_URL = `/api/sessions/${SESSION_ID}`;
const PAIRING_A = "1190245"; // creds.registrationId shapes
const PAIRING_B = "8842101";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Gateway session response with a STABLE pairingId (R104 gateway shape). */
function installFetchMock(pairingId: string | (() => string | undefined), status = "ready") {
  const calls: Array<{ url: string }> = [];
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url });
    if (url.endsWith(SESSION_URL)) {
      const pid = typeof pairingId === "function" ? pairingId() : pairingId;
      return jsonResponse({
        id: SESSION_ID,
        name: "subnation-otp",
        status,
        pairingId: pid,
        lastReadyAt: new Date().toISOString(), // rewritten every open — the OLD broken epoch
        connectedAt: new Date().toISOString(),
      });
    }
    if (url.endsWith("/messages/send-text")) {
      return jsonResponse({ success: true });
    }
    return jsonResponse({ ready: true });
  }) as unknown as typeof fetch;
  return calls;
}

async function importOpenwa() {
  const mod = await import("../openwa.service");
  mod.__resetWhatsAppGatewayCacheForTests();
  mod.__resetWhatsAppReadinessCacheForTests();
  return mod;
}

/** Simulate the COLD PROCESS of a post-sleep wake: drop every in-memory
 * gate map (the Neon marker in system_settings survives, exactly like a
 * real Render spin-down/spin-up). */
function coldRestart(mod: Awaited<ReturnType<typeof importOpenwa>>): void {
  mod.__resetSettleGateStateForTests();
  mod.__resetWhatsAppGatewayCacheForTests();
  mod.__resetWhatsAppReadinessCacheForTests();
}

/** The marker writes are fire-and-forget (void) — flush the microtask
 * queue so assertions never race the upsert. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

async function readMarker(): Promise<{
  epoch: string;
  readySince: number;
  warmed: boolean;
} | null> {
  const rows = (await db.execute(
    sql`SELECT value FROM system_settings WHERE key = ${"openwa:epoch:" + SESSION_ID}`,
  )) as unknown as { rows?: Array<{ value?: string }> };
  const raw = rows?.rows?.[0]?.value;
  if (!raw) return null;
  return JSON.parse(raw) as { epoch: string; readySince: number; warmed: boolean };
}

describe("whatsapp epoch memory (R104 AG4-2) — stable pairingId + Neon marker", () => {
  beforeAll(async () => {
    // initTestDb runs non-idempotent CREATE TYPE DDL — ONCE per file
    // (the pglite harness contract; per-test cleanup is row-level).
    await initTestDb();
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS system_settings (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`,
    );
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM system_settings WHERE key = ${"openwa:epoch:" + SESSION_ID}`);
    process.env.WHATSAPP_OTP_BASE_URL = "http://openwa.test";
    process.env.WHATSAPP_OTP_API_KEY = "owa_k1_test_key";
    process.env.WHATSAPP_OTP_SESSION = SESSION_ID;
    process.env.WHATSAPP_OTP_SETTLE_MS = "45000";
    delete process.env.WHATSAPP_OTP_OPERATOR_E164;
    delete process.env.WHATSAPP_OTP_DISABLE_EPOCH_MEMORY;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("1. first observation (no marker) → fresh FULL window + marker persisted (warmed:false)", async () => {
    installFetchMock(PAIRING_A);
    const mod = await importOpenwa();

    const r = await mod.getWhatsAppGatewayReadiness();
    // Fresh epoch: full 45 s window remains.
    expect(r).toMatchObject({ status: "ready", ready: false, settling: true });
    expect(r.readyInSec).toBeGreaterThan(40);

    const marker = await readMarker();
    expect(marker).not.toBeNull();
    expect(marker?.epoch).toBe(PAIRING_A);
    expect(marker?.warmed).toBe(false);
  });

  it("2. cold process + SAME pairingId → ADOPTED: only the 5 s residual remains (not 45 s)", async () => {
    // Boot 1: record the epoch + let the window fully elapse.
    installFetchMock(PAIRING_A);
    const mod = await importOpenwa();
    await mod.getWhatsAppGatewayReadiness();
    await vi.advanceTimersByTimeAsync(46_000);
    const settled = await mod.getWhatsAppGatewayReadiness();
    expect(settled).toMatchObject({ ready: true, settling: false });
    await flushAsync();

    // Boot 2 (cold process — in-memory gate maps dropped, marker in the
    // "DB"): the gateway reports the SAME pairingId (routine restore).
    coldRestart(mod);
    const r2 = await mod.getWhatsAppGatewayReadiness();
    // The wake-ceremony elimination: at most the 5 s residual, NOT a
    // fresh 45 s window (the pre-R104 behavior).
    expect(r2).toMatchObject({ status: "ready", ready: false, settling: true });
    expect(r2.readyInSec).toBeLessThanOrEqual(5);
    expect(r2.readyInSec).toBeGreaterThan(0);
  });

  it("3. cold process + CHANGED pairingId (true re-pair) → full fresh window + marker overwritten", async () => {
    installFetchMock(PAIRING_A);
    const mod = await importOpenwa();
    coldRestart(mod); // clean gate state (tests share module state in-file)
    await mod.getWhatsAppGatewayReadiness();
    await vi.advanceTimersByTimeAsync(46_000);

    // Cold process #2: in-memory gate state dropped; marker survives in
    // system_settings (NO vi.resetModules — that would re-import the db
    // harness into a second pglite instance).
    let pairing = PAIRING_A;
    installFetchMock(() => pairing);
    coldRestart(mod);
    await mod.getWhatsAppGatewayReadiness(); // marker read under A
    await vi.advanceTimersByTimeAsync(46_000);

    // The operator re-pairs: new registrationId → new epoch. The mock
    // must now return B (the closure-backed install).
    pairing = PAIRING_B;
    installFetchMock(() => pairing);
    coldRestart(mod);
    const r3 = await mod.getWhatsAppGatewayReadiness();
    expect(r3).toMatchObject({ status: "ready", ready: false, settling: true });
    // FULL window re-armed (the pre-R104 protection for fresh pairings).
    expect(r3.readyInSec).toBeGreaterThan(40);
    // The fire-and-forget upsert rides pglite's real-async WASM loop —
    // waitFor (which advances fake timers while polling) lands it.
    await vi.waitFor(async () => {
      expect(await readMarker()).toMatchObject({ epoch: PAIRING_B, warmed: false });
    });
  });

  it("4. marker warmed:true → dispatch gate adopted (no warm-up re-send after restore)", async () => {
    // Boot 1 with the operator number set: window elapses → the warm-up
    // self-check delivers → marker flips to warmed:true.
    process.env.WHATSAPP_OTP_OPERATOR_E164 = "218913456789";
    const calls = installFetchMock(PAIRING_A);
    const mod = await importOpenwa();
    coldRestart(mod); // clean gate state (tests share module state in-file)
    await mod.getWhatsAppGatewayReadiness();
    await vi.advanceTimersByTimeAsync(46_000);
    // The intent-driven cycle that delivers the self-check:
    await mod.__whatsappSettleGateTest.runWarmupCycle();
    await vi.waitFor(async () => {
      expect(await readMarker()).toMatchObject({ epoch: PAIRING_A, warmed: true });
    });
    const sendCallsAfterBoot1 = calls.filter((c) => c.url.includes("send-text")).length;
    expect(sendCallsAfterBoot1).toBe(1);

    // Boot 2 (restore, same pairing): dispatch must be adopted with NO
    // second self-message. The SAME mock instance keeps counting — the
    // assertion is that its send-text total stays at exactly 1.
    coldRestart(mod);
    const r2 = await mod.getWhatsAppGatewayReadiness();
    expect(r2.readyInSec).toBeLessThanOrEqual(5); // residual only
    // The restored epoch is already warm — dispatch enabled without any
    // send-text on the gateway.
    expect(mod.__whatsappSettleGateTest.isDispatchReady(SESSION_ID, PAIRING_A)).toBe(true);
    const sendCallsTotal = calls.filter((c) => c.url.includes("send-text")).length;
    expect(sendCallsTotal).toBe(1); // boot-1's self-check ONLY — no re-send
  });

  it("5. WHATSAPP_OTP_DISABLE_EPOCH_MEMORY=true → no adoption (operator kill switch)", async () => {
    process.env.WHATSAPP_OTP_DISABLE_EPOCH_MEMORY = "true";
    installFetchMock(PAIRING_A);
    const mod = await importOpenwa();
    await mod.getWhatsAppGatewayReadiness();
    await flushAsync();
    expect(await readMarker()).toBeNull(); // nothing persisted either

    coldRestart(mod);
    const r2 = await mod.getWhatsAppGatewayReadiness();
    // Kill switch = the pre-R104 behavior: a full fresh window on every
    // process start.
    expect(r2.readyInSec ?? 0).toBeGreaterThan(40);
  });
});
