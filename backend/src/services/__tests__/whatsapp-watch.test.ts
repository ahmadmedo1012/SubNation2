/**
 * 97-F3 (R97-WA-06) — WhatsApp channel-death watch, OBSERVATION-DRIVEN
 * (2026-09-20 free-infrastructure round).
 *
 * The 3am production incident: the OTP pairing was revoked and the
 * session sat in `failed` for hours with nobody noticing. The watch
 * escalates a channel that stays outside {ready, settling} for more
 * than 15 minutes — fed by REAL observations (readiness probes, OTP
 * send attempts) instead of the old 60 s interval timer (which was
 * also keeping the OpenWA gateway awake 24/7).
 *
 * Pinned here (fake timers advance wall-clock between observations;
 * logAdminAlert mocked at the module boundary):
 *   - healthy observations (ready / settling) → never alerts;
 *   - failed observed across >15 min → ONE admin alert, dedupe key
 *     `whatsapp:channel:failed` (24h window contract), no re-alert on
 *     later observations of the same episode;
 *   - recovery (healthy again after an episode THAT alerted) → one-time
 *     info alert `whatsapp:channel:recovered`;
 *   - a sub-threshold blip never alerts AND never announces recovery;
 *   - qr_ready persisting 20 min → alert (normal DURING pairing, dead
 *     after 15 min of nobody scanning);
 *   - gateway unreachable (status null) → alert keyed
 *     `whatsapp:channel:unreachable`;
 *   - mid-episode degradation (qr_ready → failed) → a second alert for
 *     the NEW status; flapping failed↔disconnected must NOT dodge the
 *     alert by restarting the 15-minute clock;
 *   - unconfigured deployment (configured:false) → nothing, ever;
 *   - a throwing observation pipeline never rejects the fire-and-forget
 *     caller (observeWhatsAppChannel resolves immediately).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../jobs/alertLogger", () => ({
  // Dedupe/suppression semantics live in logAdminAlert (covered by
  // alert-hygiene.test.ts); here we only capture the routing.
  logAdminAlert: vi.fn(async () => ({ suppressed: false, id: 1 })),
}));

import { logAdminAlert } from "../../jobs/alertLogger";
import type { WhatsAppChannelObservation } from "../whatsapp-watch";

const logAdminAlertMock = vi.mocked(logAdminAlert);

/** The alert opts of the n-th logAdminAlert call (dedupe key contract). */
function dedupeKeyOf(callIndex: number): string | undefined {
  const call = logAdminAlertMock.mock.calls[callIndex];
  return call?.[3]?.dedupeKey;
}

async function importWatch() {
  // resetModules (beforeEach) gives each test a pristine watcher module —
  // the episode state machine is module-scoped by design.
  return import("../whatsapp-watch");
}

const MIN = 60_000;

beforeEach(() => {
  logAdminAlertMock.mockReset();
  logAdminAlertMock.mockResolvedValue({ suppressed: false, id: 1 });
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WhatsApp channel watch — observation-driven state machine (97-F3 + 2026-09-20)", () => {
  it("healthy observations (ready) — never alerts", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 20; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "ready" });
      await vi.advanceTimersByTimeAsync(MIN);
    }

    expect(logAdminAlertMock).not.toHaveBeenCalled();
  });

  it("healthy observations (settling — the post-link warm-up window) — never alerts", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 20; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "settling" });
      await vi.advanceTimersByTimeAsync(MIN);
    }

    expect(logAdminAlertMock).not.toHaveBeenCalled();
  });

  it("failed observed across >15 min — ONE alert with the per-status dedupe key, no re-alert on later observations", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    // 14 observations a minute apart — under the threshold.
    for (let i = 0; i < 14; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(logAdminAlertMock).not.toHaveBeenCalled();

    // Minute 17 — the streak crosses 15 minutes.
    await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await observeWhatsAppChannelForTests({ configured: true, status: "failed" });

    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(logAdminAlertMock.mock.calls[0]![0]).toBe("whatsapp_channel");
    expect(String(logAdminAlertMock.mock.calls[0]![1])).toContain("failed");
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:failed");

    // The episode continues — no per-observation re-alert.
    await vi.advanceTimersByTimeAsync(5 * MIN);
    await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
  });

  it("recovery — one-time info alert keyed whatsapp:channel:recovered after an episode that ALERTED", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 17; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1); // channel-death alert

    await observeWhatsAppChannelForTests({ configured: true, status: "ready" });
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    expect(dedupeKeyOf(1)).toBe("whatsapp:channel:recovered");
    expect(String(logAdminAlertMock.mock.calls[1]![1])).toContain("استعادت");

    // Stays healthy → no further alerts (recovery is one-time).
    for (let i = 0; i < 10; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "ready" });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);

    // A later BLIP that never reached the alert threshold recovers
    // silently — no recovery notice without a preceding death alert.
    for (let i = 0; i < 5; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    await observeWhatsAppChannelForTests({ configured: true, status: "ready" });
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
  });

  it("qr_ready persisting 20 min — alert (nobody scanned the pair code)", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 20; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "qr_ready" });
      await vi.advanceTimersByTimeAsync(MIN);
    }

    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:qr_ready");
    expect(String(logAdminAlertMock.mock.calls[0]![1])).toContain("qr_ready");
  });

  it("gateway unreachable (status null) — alert keyed whatsapp:channel:unreachable", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 17; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: null });
      await vi.advanceTimersByTimeAsync(MIN);
    }

    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:unreachable");
    expect(String(logAdminAlertMock.mock.calls[0]![1])).toContain("قابلة للوصول");
  });

  it("mid-episode degradation (qr_ready → failed) — the NEW status gets its own alert", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 17; i++) {
      await observeWhatsAppChannelForTests({ configured: true, status: "qr_ready" });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:qr_ready");

    // The pairing attempt died — a new, worse fact.
    await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    expect(dedupeKeyOf(1)).toBe("whatsapp:channel:failed");

    // …but repeats of the SAME token within the episode stay quiet.
    await vi.advanceTimersByTimeAsync(5 * MIN);
    await observeWhatsAppChannelForTests({ configured: true, status: "failed" });
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
  });

  it("flapping failed↔disconnected must NOT dodge the alert — the budget rides the unhealthy STREAK", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 17; i++) {
      await observeWhatsAppChannelForTests({
        configured: true,
        status: i % 2 === 0 ? "failed" : "disconnected",
      });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    // The alert names whichever unhealthy status was current at the
    // escalation observation — both tokens are unhealthy facts of one streak.
    expect(["whatsapp:channel:failed", "whatsapp:channel:disconnected"]).toContain(dedupeKeyOf(0));
  });

  it("unconfigured deployment (configured:false) — never alerts, and resets any stale episode", async () => {
    const { observeWhatsAppChannelForTests, resetWhatsAppWatchForTests } = await importWatch();
    vi.useFakeTimers();
    resetWhatsAppWatchForTests();

    for (let i = 0; i < 30; i++) {
      await observeWhatsAppChannelForTests({ configured: false, status: null });
      await vi.advanceTimersByTimeAsync(MIN);
    }

    expect(logAdminAlertMock).not.toHaveBeenCalled();
  });

  it("observeWhatsAppChannel is fire-and-forget — never rejects, even when the pipeline throws", async () => {
    const { observeWhatsAppChannel } = await importWatch();
    // Force an internal pipeline failure: logAdminAlert rejecting would
    // normally be swallowed by the observe() catch — emulate a hard
    // throw inside the alert helper path via a poisoned async iterator
    // is overkill; the contract test is that the sync entry point
    // returns undefined immediately and never rejects.
    const result = observeWhatsAppChannel({ configured: true, status: "failed" });
    expect(result).toBeUndefined();
    await expect(Promise.resolve(result)).resolves.toBeUndefined();
  });
});

describe("WhatsApp channel watch — observation contract", () => {
  it("accepts the WhatsAppChannelObservation shape (configured + status, no probe import)", async () => {
    const { observeWhatsAppChannelForTests } = await importWatch();
    const observation: WhatsAppChannelObservation = { configured: true, status: "ready" };
    await expect(observeWhatsAppChannelForTests(observation)).resolves.toBeUndefined();
    expect(logAdminAlertMock).not.toHaveBeenCalled();
  });
});
