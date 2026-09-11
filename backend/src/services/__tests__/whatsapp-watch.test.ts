/**
 * 97-F3 (R97-WA-06) — WhatsApp channel-death watch.
 *
 * The 3am production incident: the OTP pairing was revoked and the
 * session sat in `failed` for hours with nobody noticing — no WhatsApp
 * rule in ALERT_RULES, no ticker, nothing. This watcher polls the SAME
 * readiness probe every 60 s and escalates a channel that stays outside
 * {ready, settling} for more than 15 minutes.
 *
 * Pinned here (fake timers; the probe + logAdminAlert mocked at the
 * module boundary):
 *   - healthy channel → never alerts;
 *   - failed for 16 min → ONE admin alert, dedupe key
 *     `whatsapp:channel:failed` (24h window contract), and no re-alert
 *     on later ticks of the same episode;
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
 *   - stop() cancels the interval (no further probes, no alerts);
 *   - the 60 s probe cadence (immediate baseline tick + one per minute).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openwa.service", () => ({
  getWhatsAppGatewayReadiness: vi.fn(),
}));

vi.mock("../../jobs/alertLogger", () => ({
  // Dedupe/suppression semantics live in logAdminAlert (covered by
  // alert-hygiene.test.ts); here we only capture the routing.
  logAdminAlert: vi.fn(async () => ({ suppressed: false, id: 1 })),
}));

import { getWhatsAppGatewayReadiness } from "../openwa.service";
import { logAdminAlert } from "../../jobs/alertLogger";
import type { WhatsAppGatewayReadiness } from "../openwa.service";

const readinessMock = vi.mocked(getWhatsAppGatewayReadiness);
const logAdminAlertMock = vi.mocked(logAdminAlert);

function readinessOf(status: string | null, configured = true): WhatsAppGatewayReadiness {
  return {
    configured,
    ready: status === "ready",
    status,
    settling: status === "settling",
    readyInSec: null,
    probedAt: Date.now(),
  };
}

function setReadiness(status: string | null, configured = true): void {
  readinessMock.mockResolvedValue(readinessOf(status, configured));
}

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
  readinessMock.mockReset();
  logAdminAlertMock.mockReset();
  logAdminAlertMock.mockResolvedValue({ suppressed: false, id: 1 });
  setReadiness("ready");
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WhatsApp channel watch — state machine (97-F3 / R97-WA-06)", () => {
  it("healthy channel (ready) — never alerts", async () => {
    setReadiness("ready");
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(20 * MIN);

    expect(logAdminAlertMock).not.toHaveBeenCalled();
    handle.stop();
  });

  it("healthy channel (settling — the post-link warm-up window) — never alerts", async () => {
    setReadiness("settling");
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(20 * MIN);

    expect(logAdminAlertMock).not.toHaveBeenCalled();
    handle.stop();
  });

  it("failed continuously — alert fires ONCE after >15 min with the per-status dedupe key, and does not re-alert on later ticks", async () => {
    setReadiness("failed");
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(14 * MIN);
    expect(logAdminAlertMock).not.toHaveBeenCalled(); // still under the threshold

    await vi.advanceTimersByTimeAsync(3 * MIN); // 17 unhealthy minutes
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(logAdminAlertMock.mock.calls[0]![0]).toBe("whatsapp_channel");
    expect(String(logAdminAlertMock.mock.calls[0]![1])).toContain("failed");
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:failed");

    // The episode continues — no per-tick re-alert (logAdminAlert's 24h
    // dedupe is the durable guard; the watcher adds per-episode memory).
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("recovery — one-time info alert keyed whatsapp:channel:recovered after an episode that ALERTED", async () => {
    let status: string | null = "failed";
    readinessMock.mockImplementation(async () => readinessOf(status));
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(16 * MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1); // channel-death alert

    status = "ready";
    await vi.advanceTimersByTimeAsync(MIN); // next tick observes recovery
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    expect(dedupeKeyOf(1)).toBe("whatsapp:channel:recovered");
    expect(String(logAdminAlertMock.mock.calls[1]![1])).toContain("استعادت");

    // Stays healthy → no further alerts (recovery is one-time).
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);

    // A later BLIP that never reached the alert threshold recovers
    // silently — no recovery notice without a preceding death alert.
    status = "failed";
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    status = "ready";
    await vi.advanceTimersByTimeAsync(MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("qr_ready persisting 20 min — alert (nobody scanned the pair code)", async () => {
    setReadiness("qr_ready");
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(20 * MIN);

    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:qr_ready");
    expect(String(logAdminAlertMock.mock.calls[0]![1])).toContain("qr_ready");
    handle.stop();
  });

  it("gateway unreachable (status null) — alert keyed whatsapp:channel:unreachable", async () => {
    setReadiness(null);
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(16 * MIN);

    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:unreachable");
    expect(String(logAdminAlertMock.mock.calls[0]![1])).toContain("قابلة للوصول");
    handle.stop();
  });

  it("mid-episode degradation (qr_ready → failed) — the NEW status gets its own alert", async () => {
    let status: string | null = "qr_ready";
    readinessMock.mockImplementation(async () => readinessOf(status));
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(16 * MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    expect(dedupeKeyOf(0)).toBe("whatsapp:channel:qr_ready");

    status = "failed"; // the pairing attempt died — a new, worse fact
    await vi.advanceTimersByTimeAsync(MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    expect(dedupeKeyOf(1)).toBe("whatsapp:channel:failed");

    // …but repeats of the SAME token within the episode stay quiet.
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(logAdminAlertMock).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("flapping failed↔disconnected must NOT dodge the alert — the 15-minute budget rides the unhealthy STREAK", async () => {
    let status: string | null = "failed";
    readinessMock.mockImplementation(async () => readinessOf(status));
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    // Alternate the unhealthy status every 2 minutes for 16 minutes.
    for (let i = 0; i < 8; i += 1) {
      status = i % 2 === 0 ? "failed" : "disconnected";
      await vi.advanceTimersByTimeAsync(2 * MIN);
    }
    expect(logAdminAlertMock).toHaveBeenCalledTimes(1);
    // The alert names whichever unhealthy status was current at the
    // escalation tick — both tokens are unhealthy facts of one streak.
    expect(["whatsapp:channel:failed", "whatsapp:channel:disconnected"]).toContain(dedupeKeyOf(0));
    handle.stop();
  });

  it("unconfigured deployment (configured:false) — never alerts", async () => {
    setReadiness(null, false);
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(30 * MIN);

    expect(logAdminAlertMock).not.toHaveBeenCalled();
    handle.stop();
  });

  it("stop() cancels the watch — no further probes, no alerts", async () => {
    setReadiness("failed");
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    // The immediate baseline tick runs (and starts the unhealthy clock)…
    await vi.advanceTimersByTimeAsync(0);
    const probesBefore = readinessMock.mock.calls.length;
    expect(probesBefore).toBeGreaterThan(0);

    handle.stop();
    await vi.advanceTimersByTimeAsync(30 * MIN);

    expect(readinessMock.mock.calls.length).toBe(probesBefore); // interval dead
    expect(logAdminAlertMock).not.toHaveBeenCalled(); // …and it never escalated
  });

  it("probe cadence — an immediate baseline tick, then one readiness probe per 60 s", async () => {
    setReadiness("ready");
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    await vi.advanceTimersByTimeAsync(20 * MIN);

    // 1 baseline + 20 interval ticks. (The probe's own 30 s cache is
    // accepted by design — the watcher calls the shared probe, and a
    // coalesced observation is noise the 15-minute budget absorbs.)
    expect(readinessMock.mock.calls.length).toBe(21);
    handle.stop();
  });

  it("tick failures never throw across the timer — a probe rejection is swallowed and the watch carries on", async () => {
    readinessMock.mockRejectedValue(new Error("probe exploded"));
    const { startWhatsAppChannelWatch } = await importWatch();
    vi.useFakeTimers();

    const handle = startWhatsAppChannelWatch();
    // The immediate baseline tick rejects internally (logged, not thrown)…
    await vi.advanceTimersByTimeAsync(0);
    // …and the interval keeps ticking without unhandled rejections.
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(readinessMock.mock.calls.length).toBe(4); // baseline + 3 ticks
    handle.stop();
  });
});

describe("WhatsApp channel watch — manual tick seam (integration contract)", () => {
  it("runWhatsAppChannelWatchTickForTests runs one interval body on demand", async () => {
    setReadiness("ready");
    const { runWhatsAppChannelWatchTickForTests } = await importWatch();
    await expect(runWhatsAppChannelWatchTickForTests()).resolves.toBeUndefined();
    expect(readinessMock).toHaveBeenCalledTimes(1);
    expect(logAdminAlertMock).not.toHaveBeenCalled();
  });
});
