import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R110-H (P2 from R109 §20) — the cron registration inventory, PINNED.
 *
 * Nothing used to assert WHAT cron.ts registers: the web-scheduler suites
 * mock initCronJobs entirely, so a dropped schedule(), a typo'd expression
 * (e.g. "35 3 * * *" → "35 3 * *"), or a lost timezone:"UTC" would pass
 * CI silently and silently shift the documented daily ladder. This suite
 * imports the REAL cron.ts with node-cron mocked at the module boundary
 * (same scaffold as web-scheduler-single-instance.test.ts), captures every
 * schedule() call, and asserts the full inventory literally — expression,
 * source order, and { timezone: "UTC" } on all ten slots. The hourly/no-op
 * jobs removed in the 2026-09-20 free-infrastructure round stay removed by
 * construction: any reintroduction changes the array and fails here.
 *
 * It also drives the real 05:00-slot handler (jobs mocked) to pin the
 * R110-H failure-isolation fix: the three prunes in that slot have
 * independent try/catch blocks + per-job Sentry tags, so one failing can
 * never skip the others (the old chain let a pruneStaleAdminSessions
 * failure silently skip pruneOldNotifications).
 */

const { scheduleCalls, taskHandles } = vi.hoisted(() => ({
  scheduleCalls: [] as Array<{ expression: string; handler: unknown; options: unknown }>,
  taskHandles: [] as Array<{ stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn((expression: string, handler: unknown, options: unknown) => {
      scheduleCalls.push({ expression, handler, options });
      const task = { stop: vi.fn() };
      taskHandles.push(task);
      return task;
    }),
  },
}));

// Job modules mocked at the module boundary — the unit under test is
// cron.ts's WIRING (registrations + handler isolation), not the jobs'
// behavior (each job has its own suite).
vi.mock("../alertLogger", () => ({
  markStaleUnreadAlertsRead: vi.fn(async () => 0),
  pruneReadAlerts: vi.fn(async () => 0),
}));
vi.mock("../cleanup-auth-activity", () => ({ cleanupOldAuthActivity: vi.fn(async () => 0) }));
vi.mock("../forecast-runner", () => ({ runForecastIfPermitted: vi.fn(async () => undefined) }));
vi.mock("../forecast-retention", () => ({ runForecastRetention: vi.fn(async () => undefined) }));
vi.mock("../enrichment-runner", () => ({ runEnrichmentIfPermitted: vi.fn(async () => undefined) }));
vi.mock("../enrichment-retention", () => ({
  runEnrichmentRetention: vi.fn(async () => undefined),
}));
vi.mock("../risk-retention", () => ({
  reapExpiredRiskEvents: vi.fn(async () => ({ unlabeledDeleted: 0, labeledExpiredDeleted: 0 })),
}));
vi.mock("../session-prune", () => ({ pruneExpiredSessions: vi.fn(async () => 0) }));
vi.mock("../../lib/admin-session", () => ({ pruneStaleAdminSessions: vi.fn(async () => 0) }));
vi.mock("../idempotency-retention", () => ({ pruneOldIdempotencyKeys: vi.fn(async () => 0) }));
vi.mock("../notifications-retention", () => ({ pruneOldNotifications: vi.fn(async () => 0) }));
// R111 (B1-2/B6-05): the two newest 05:00-slot prunes — mocked at the
// module boundary like every sibling (unit under test = cron wiring).
vi.mock("../auth-audit-retention", () => ({
  pruneStaleLoginAttempts: vi.fn(async () => 0),
  pruneOldAuditLogs: vi.fn(async () => 0),
}));
vi.mock("../security-advisories", () => ({ checkAdminTotpAdvisory: vi.fn(async () => undefined) }));
vi.mock("../../lib/sentry", () => ({ captureSchedulerFailure: vi.fn() }));

import { initCronJobs } from "../cron";
import { pruneExpiredSessions } from "../session-prune";
import { pruneStaleAdminSessions } from "../../lib/admin-session";
import { pruneOldNotifications } from "../notifications-retention";
import { pruneStaleLoginAttempts, pruneOldAuditLogs } from "../auth-audit-retention";
import { captureSchedulerFailure } from "../../lib/sentry";

/**
 * The pinned inventory — cron.ts source order. Every slot is a daily
 * (5-field) expression on the 00:00-05:00 UTC ladder with an explicit
 * timezone; the worker-tier-gated runner/retention slots (6/7/8/9) are
 * registered unconditionally and gate INSIDE their handlers.
 */
const PINNED_INVENTORY: ReadonlyArray<[string, string]> = [
  ["0 0 * * *", "1  — admin-alert retention (unread→read 14d, read→delete 30d)"],
  ["0 0 * * *", "1c — idempotency_keys retention (48h)"],
  ["5 0 * * *", "1a — TOTP security advisory"],
  [
    "0 5 * * *",
    "1b — user-session + admin-session + notifications + login-attempts + audit-logs prune",
  ],
  ["30 3 * * *", "5  — risk_events retention (90d unlabeled / 97d labeled)"],
  ["15 2 * * *", "6  — inventory demand forecast runner (worker-tier gated)"],
  ["35 3 * * *", "7  — forecast retention + capture-rate (worker-tier gated)"],
  ["50 3 * * *", "8  — catalog enrichment runner (worker-tier gated)"],
  ["0 4 * * *", "9  — enrichment retention (worker-tier gated)"],
  ["30 4 * * *", "10 — auth_activity retention (90d)"],
];

beforeEach(() => {
  scheduleCalls.length = 0;
  taskHandles.length = 0;
  vi.clearAllMocks();
});

describe("R110-H — cron.ts registration inventory (the P2 pin)", () => {
  it("registers exactly the 10 daily-ladder slots — literal expressions, source order, every one timezone UTC", () => {
    const handle = initCronJobs();
    handle.stop();

    expect(scheduleCalls.map(({ expression, options }) => [expression, options])).toEqual(
      PINNED_INVENTORY.map(([expression]) => [expression, { timezone: "UTC" }]),
    );
    // Every registration passes a callable handler (node-cron signature).
    for (const call of scheduleCalls) {
      expect(typeof call.handler).toBe("function");
    }
    // Exactly ten — a dropped OR extra schedule() both fail the literal
    // array above; this makes the count legible in failure output.
    expect(scheduleCalls).toHaveLength(PINNED_INVENTORY.length);
  });

  it("stop() stops every registered task exactly once (R8 drain handle)", () => {
    const handle = initCronJobs();
    expect(taskHandles).toHaveLength(PINNED_INVENTORY.length);

    handle.stop();

    expect(taskHandles).toHaveLength(PINNED_INVENTORY.length);
    for (const task of taskHandles) {
      expect(task.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("05:00 slot: a user-session prune failure does NOT skip the admin-session or notifications prunes", async () => {
    vi.mocked(pruneExpiredSessions).mockRejectedValueOnce(new Error("user-session blip"));
    const handle = initCronJobs();
    handle.stop();
    const slot = scheduleCalls.find((c) => c.expression === "0 5 * * *");
    expect(slot).toBeDefined();

    // Must resolve (own catch) and run the OTHER two prunes regardless.
    await expect((slot!.handler as () => Promise<void>)()).resolves.toBeUndefined();

    expect(pruneStaleAdminSessions).toHaveBeenCalledTimes(1);
    expect(pruneOldNotifications).toHaveBeenCalledTimes(1);
    // R111: the slot's two newest prunes also ran (and their failures
    // would carry their OWN Sentry tags — pinned in the next test).
    expect(pruneStaleLoginAttempts).toHaveBeenCalledTimes(1);
    expect(pruneOldAuditLogs).toHaveBeenCalledTimes(1);
    expect(captureSchedulerFailure).toHaveBeenCalledWith("session_prune", expect.any(Error), {
      cron_expression: "0 5 * * *",
    });
    expect(captureSchedulerFailure).toHaveBeenCalledTimes(1);
  });

  it("05:00 slot: an audit-logs retention failure does NOT skip the other prunes and is tagged audit_logs_retention (R111)", async () => {
    vi.mocked(pruneOldAuditLogs).mockRejectedValueOnce(new Error("audit blip"));
    const handle = initCronJobs();
    handle.stop();
    const slot = scheduleCalls.find((c) => c.expression === "0 5 * * *");
    expect(slot).toBeDefined();

    await expect((slot!.handler as () => Promise<void>)()).resolves.toBeUndefined();

    expect(pruneExpiredSessions).toHaveBeenCalledTimes(1);
    expect(pruneStaleAdminSessions).toHaveBeenCalledTimes(1);
    expect(pruneOldNotifications).toHaveBeenCalledTimes(1);
    expect(pruneStaleLoginAttempts).toHaveBeenCalledTimes(1);
    expect(captureSchedulerFailure).toHaveBeenCalledWith(
      "audit_logs_retention",
      expect.any(Error),
      {
        cron_expression: "0 5 * * *",
      },
    );
    expect(captureSchedulerFailure).toHaveBeenCalledTimes(1);
  });

  it("05:00 slot: an admin-session prune failure does NOT skip the notifications prune and is tagged admin_session_prune (not the blanket session_prune)", async () => {
    vi.mocked(pruneStaleAdminSessions).mockRejectedValueOnce(new Error("admin-session blip"));
    const handle = initCronJobs();
    handle.stop();
    const slot = scheduleCalls.find((c) => c.expression === "0 5 * * *");
    expect(slot).toBeDefined();

    await expect((slot!.handler as () => Promise<void>)()).resolves.toBeUndefined();

    expect(pruneExpiredSessions).toHaveBeenCalledTimes(1);
    expect(pruneOldNotifications).toHaveBeenCalledTimes(1);
    expect(captureSchedulerFailure).toHaveBeenCalledWith("admin_session_prune", expect.any(Error), {
      cron_expression: "0 5 * * *",
    });
    // The mislabel bug: an admin-session failure used to be captured as
    // "session_prune" (the user-session job's tag).
    expect(captureSchedulerFailure).not.toHaveBeenCalledWith(
      "session_prune",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("05:00 slot: a notifications prune failure gets its own tag and never affects the session prunes", async () => {
    vi.mocked(pruneOldNotifications).mockRejectedValueOnce(new Error("notifications blip"));
    const handle = initCronJobs();
    handle.stop();
    const slot = scheduleCalls.find((c) => c.expression === "0 5 * * *");
    expect(slot).toBeDefined();

    await expect((slot!.handler as () => Promise<void>)()).resolves.toBeUndefined();

    expect(pruneExpiredSessions).toHaveBeenCalledTimes(1);
    expect(pruneStaleAdminSessions).toHaveBeenCalledTimes(1);
    expect(captureSchedulerFailure).toHaveBeenCalledWith(
      "notifications_retention",
      expect.any(Error),
      { cron_expression: "0 5 * * *" },
    );
  });
});
