import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R146 audit F4 — alerting evaluator topology contract (worker side).
 *
 * The evaluator used to start in the worker process ("so a horizontally-
 * scaled web tier never produces duplicate alerts") — but its signals
 * (http_requests_total, http_request_duration_seconds,
 * auth_outcomes_total) increment only in the WEB process's per-process
 * prom-client registry. In the documented DISABLE_WEB_SCHEDULERS +
 * dedicated-worker topology that made api_5xx_rate_high,
 * api_p95_latency_high, auth_failure_rate_high, abnormal_lockouts and
 * firebase_verifyidtoken_failures silently never fire (absent metric →
 * rule returns false).
 *
 * The evaluator now always starts on the web process (lib/web-scheduler.ts
 * — pinned by the DISABLE_WEB_SCHEDULERS cases in
 * web-scheduler-single-instance / -demotion tests). This file pins the
 * OTHER half: worker.ts must not start (or stop) an evaluator of its own.
 *
 * Source-contract test (same technique as rate-limits-intent.test.ts)
 * because startWorker is main-module-guarded and boots Redis/cron —
 * untestable without a live worker process.
 */

const WORKER_SRC = readFileSync(path.resolve(import.meta.dirname, "../src/worker.ts"), "utf8");

describe("R146 F4 — the worker does not run the alerting evaluator", () => {
  it("worker.ts neither imports nor starts/stops alertingService", () => {
    expect(WORKER_SRC).not.toMatch(/services\/alerting\.service/);
    expect(WORKER_SRC).not.toMatch(/alertingService\.(start|stop)\s*\(/);
  });
});
