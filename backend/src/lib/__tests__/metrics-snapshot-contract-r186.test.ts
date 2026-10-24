import { describe, expect, it } from "vitest";
import { buildMetricsSnapshot } from "../metrics-snapshot";
import { getRegistry, safeInc, telegramSendsTotal, workerJobsTotal } from "../metrics";
// Importing the integration-counter families registers them on the
// singleton registry (module-top `new Counter({ registers: [...] })`) —
// the class pin below walks exactly that registry.
import { recordForecastRun } from "../forecast/metrics";
import { recordEventScored } from "../risk-metrics";

/**
 * R186 (F-F1 / I-F2 + F-F3) — the operator-snapshot contract.
 *
 * The audit wave found two counters whose read-side was wired but whose
 * write-side (or snapshot-side) was missing:
 *
 *   - telegram_sends_total: the counter's own doc block PROMISED
 *     "Surfaces in /api/admin/observability/metrics and the admin
 *     system page" — but the snapshot builder never extracted it
 *     (F-F1). The counter itself is healthy (telegram.ts increments
 *     all four outcomes).
 *   - worker_jobs_total: read by metrics-snapshot's `worker` block and
 *     rendered by the admin system page's background-jobs panel, but
 *     never registered or incremented anywhere (I-F2/F-F3) — the panel
 *     showed its empty state forever.
 *
 * This is the class pin: a registered integration counter must reach
 * the operator snapshot. The registry-walk idiom follows
 * idempotency-degradation.test.ts (getMetricsAsJSON → find by name);
 * the boot-chain increment wiring itself is pinned separately in
 * jobs/__tests__/boot-one-shot-worker-metrics-r186.test.ts.
 */

/** prom-client's getMetricsAsJSON() shape, narrowed to what we read. */
type MetricJson = {
  name: string;
  values: Array<{ labels: Record<string, string>; value: number }>;
};

async function registryNames(): Promise<string[]> {
  const metrics = (await getRegistry().getMetricsAsJSON()) as unknown as MetricJson[];
  return metrics.map((m) => m.name);
}

describe("R186 — registered integration counters must reach the operator snapshot", () => {
  it("telegram_sends_total → snapshot.telegram.sendsTotal with the event:outcome key (F-F1)", async () => {
    safeInc(telegramSendsTotal, { event: "order_new", outcome: "failure" });

    const snap = await buildMetricsSnapshot();

    // The counter's doc promise, pinned: the "deliveries stopped" cell
    // is readable on the operator surface, not just the /api/metrics
    // scrape. (Counters accumulate within a file — ≥, not ==.)
    expect(snap.telegram.sendsTotal["order_new:failure"]).toBeGreaterThanOrEqual(1);
  });

  it("worker_jobs_total → snapshot.worker.jobsTotal with the job:status key (I-F2/F-F3)", async () => {
    safeInc(workerJobsTotal, { job: "contract-pin-job", status: "success" });

    const snap = await buildMetricsSnapshot();

    expect(snap.worker.jobsTotal["contract-pin-job:success"]).toBeGreaterThanOrEqual(1);
  });

  it("the registry the snapshot is built from carries the forecast + risk counter families (one walk, one-line pins)", async () => {
    // Exercise the record* wrappers so the families have live cells.
    recordForecastRun("failure");
    recordEventScored("order_created", "low");

    const names = await registryNames();
    expect(names).toContain("forecast_runs_total");
    expect(names).toContain("risk_events_scored_total");
    expect(names).toContain("telegram_sends_total");
    expect(names).toContain("worker_jobs_total");
  });
});
