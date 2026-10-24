import { describe, expect, it, vi } from "vitest";

/**
 * R186 (I-F2 + F-F3) — worker_jobs_total finally has a writer.
 *
 * The counter was read by metrics-snapshot's `worker` block (through the
 * OpenAPI contract's required jobsTotal field) and rendered by the admin
 * system page's background-jobs panel — but never registered or
 * incremented anywhere, so the panel showed its empty state forever.
 * boot-one-shots' sequential chain now counts every leg (safeInc — a
 * metrics failure can never break a job).
 *
 * This pin calls fireOneShotsSequentially directly with one succeeding
 * + one throwing FAKE job and asserts both {job,status} labels land on
 * the counter AND on the operator snapshot built from it. The module
 * graph is mocked per the boot-one-shot-failure-capture.test.ts shape
 * (the unit under test is the chain's accounting, not the jobs).
 */

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../lib/sentry", () => ({
  captureSchedulerFailure: vi.fn(),
}));

vi.mock("../../lib/admin-session", () => ({
  pruneStaleAdminSessions: vi.fn(async () => 0),
}));
vi.mock("../couponWatcher", () => ({
  checkExpiringCoupons: vi.fn(async () => undefined),
}));
vi.mock("../cleanup-auth-activity", () => ({
  cleanupOldAuthActivity: vi.fn(async () => 0),
}));
vi.mock("../security-advisories", () => ({
  checkAdminTotpAdvisory: vi.fn(async () => undefined),
}));
vi.mock("../session-prune", () => ({
  pruneExpiredSessions: vi.fn(async () => 0),
}));
vi.mock("../risk-retention", () => ({
  reapExpiredRiskEvents: vi.fn(async () => ({
    unlabeledDeleted: 0,
    labeledExpiredDeleted: 0,
    orphanLabelsDeleted: 0,
  })),
}));
vi.mock("../alertLogger", () => ({
  markStaleUnreadAlertsRead: vi.fn(async () => 0),
  pruneReadAlerts: vi.fn(async () => 0),
}));
vi.mock("../flashSaleWatcher", () => ({
  deactivateExpiredFlashSales: vi.fn(async () => undefined),
}));
vi.mock("../stockWatcher", () => ({
  runStockSweep: vi.fn(async () => undefined),
  reportOrphanInventory: vi.fn(async () => undefined),
}));
vi.mock("../../services/whatsapp-otp.service", () => ({
  pruneExpiredOtps: vi.fn(async () => undefined),
}));
vi.mock("../idempotency-retention", () => ({
  pruneOldIdempotencyKeys: vi.fn(async () => 0),
}));
vi.mock("../notifications-retention", () => ({
  pruneOldNotifications: vi.fn(async () => 0),
}));
vi.mock("../auth-audit-retention", () => ({
  pruneStaleLoginAttempts: vi.fn(async () => 0),
  pruneOldAuditLogs: vi.fn(async () => 0),
}));
vi.mock("../reencrypt-v1-credentials", () => ({
  reencryptV1CredentialBlobs: vi.fn(async () => undefined),
}));

import { fireOneShotsSequentially } from "../boot-one-shots";
import { getRegistry } from "../../lib/metrics";
import { buildMetricsSnapshot } from "../../lib/metrics-snapshot";

/** prom-client's getMetricsAsJSON() shape, narrowed to what we read. */
type MetricJson = {
  name: string;
  values: Array<{ labels: Record<string, string>; value: number }>;
};

/** worker_jobs_total's cells as "job:status" → count (the registry walk idiom). */
async function workerJobsCells(): Promise<Record<string, number>> {
  const metrics = (await getRegistry().getMetricsAsJSON()) as unknown as MetricJson[];
  const m = metrics.find((x) => x.name === "worker_jobs_total");
  if (!m) throw new Error("worker_jobs_total is not registered");
  const out: Record<string, number> = {};
  for (const v of m.values) {
    out[`${v.labels.job}:${v.labels.status}`] = v.value;
  }
  return out;
}

describe("R186 (I-F2/F-F3) — boot one-shot chain counts on worker_jobs_total", () => {
  it("one succeeding + one throwing fake job → both {job,status} labels on the counter AND the operator snapshot", async () => {
    fireOneShotsSequentially([
      ["pin-ok-job", async () => "fine"],
      [
        "pin-fail-job",
        async () => {
          throw new Error("boom (r186 pin)");
        },
      ],
    ]);

    // The chain is fire-and-forget — wait until both legs have settled
    // on the counter (the failing leg's catch must also complete).
    await vi.waitFor(async () => {
      const cells = await workerJobsCells();
      expect(cells["pin-ok-job:success"]).toBeGreaterThanOrEqual(1);
      expect(cells["pin-fail-job:failure"]).toBeGreaterThanOrEqual(1);
    });

    // And the snapshot (what /api/admin/observability/metrics serves)
    // carries the same cells — the panel's empty-state bug, closed.
    const snap = await buildMetricsSnapshot();
    expect(snap.worker.jobsTotal["pin-ok-job:success"]).toBeGreaterThanOrEqual(1);
    expect(snap.worker.jobsTotal["pin-fail-job:failure"]).toBeGreaterThanOrEqual(1);
  });
});
