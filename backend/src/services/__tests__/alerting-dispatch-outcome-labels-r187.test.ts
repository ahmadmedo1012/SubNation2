import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R187 (G-F1) — alerts_dispatched_total outcome labels tell the truth.
 *
 * The counter's documented union (lib/metrics.ts) is
 * delivered|deduped|rate-limited|failed, but the dark-launch branch
 * (ALERTING_ENABLED=false → would-dispatch) and the channel-skip branch
 * (no creds → skipped) BOTH incremented outcome="rate-limited" — in the
 * no-Discord/no-webhook production shape every dispatch permanently read
 * "rate-limited" on a scrape, misdescribing three distinct conditions.
 *
 * Registry-walk idiom: metrics-snapshot-contract-r186 (getMetricsAsJSON →
 * find by name). Fresh module graph per case (the alerting-reliability
 * idiom) so each leg reads a clean registry; the dispatch seam is
 * dispatchTestAlert — the same entry point POST /api/admin/alerts/test
 * uses. No REDIS_URL in the test env → the in-memory dedup + fail-open
 * rate limit, exactly the no-Redis production shape.
 */

type MetricJson = {
  name: string;
  values: Array<{ labels: Record<string, string>; value: number }>;
};

async function outcomeCells(outcome: string): Promise<number> {
  const { getRegistry } = await import("../../lib/metrics");
  const metrics = (await getRegistry().getMetricsAsJSON()) as unknown as MetricJson[];
  const metric = metrics.find((m) => m.name === "alerts_dispatched_total");
  return (metric?.values ?? []).filter((v) => v.labels.outcome === outcome).length;
}

async function importAlerting() {
  return import("../alerting.service");
}

beforeEach(() => {
  vi.resetModules();
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN-NOT-REAL";
  process.env.TELEGRAM_CHAT_ID = "42";
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.GENERIC_ALERT_WEBHOOK_URL;
  delete process.env.ALERTING_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R187 (G-F1) — alerts_dispatched_total outcome labels", () => {
  it("alerting disabled (dark launch) → every channel carries outcome would-dispatch, none rate-limited", async () => {
    process.env.ALERTING_ENABLED = "false";
    const { dispatchTestAlert } = await importAlerting();

    const { alert, delivery } = await dispatchTestAlert();

    expect(alert.rule).toBe("api_5xx_rate_high");
    expect(delivery).toHaveLength(3);
    expect(delivery.every((r) => r.outcome === "would-dispatch")).toBe(true);

    // The counter cells the operator scrapes: 3 would-dispatch (one per
    // channel), zero conflated rate-limited cells.
    expect(await outcomeCells("would-dispatch")).toBe(3);
    expect(await outcomeCells("rate-limited")).toBe(0);
    expect(await outcomeCells("skipped")).toBe(0);
  });

  it("no channel creds configured → the skip branch carries outcome skipped, none rate-limited", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const { dispatchTestAlert } = await importAlerting();

    const { delivery } = await dispatchTestAlert();

    expect(delivery).toHaveLength(3);
    // The per-channel dedup claim races the concurrent dispatch
    // (dispatchAlert runs the three channels in one Promise.all), so the
    // sibling channels may legitimately read "deduped" — the pin is the
    // FIRST channel's creds check: unconfigured → "skipped", never
    // "rate-limited".
    expect(delivery.find((r) => r.channel === "telegram")!.outcome).toBe("skipped");

    expect(await outcomeCells("skipped")).toBeGreaterThanOrEqual(1);
    expect(await outcomeCells("rate-limited")).toBe(0);
  });
});
