import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R127-L3 (B7 P3-1) — boot one-shot chain failure honesty.
 *
 * The chain's outer catch in fireOneShotsSequentially was WARN-ONLY and
 * UNCAPPED (invisible to Sentry — and for copilot-reaper /
 * whatsapp-otp-prune / reencrypt-v1-credentials there was no internal
 * captureSchedulerFailure either), while the message promised every
 * failing entry "will run again at its cron slot" — FALSE for 7 of the
 * 17 (no cron slot exists for coupon/stock sweeps, orphan-report,
 * copilot-reaper, otp-prune, flash-sale-catchup, reencrypt; B7 §2).
 *
 * The fix under test: captureSchedulerFailure(name, err, { trigger:
 * "boot_one_shot" }) in the catch + a per-kind retry message driven by
 * BOOT_ONE_SHOT_RETRY_KINDS (cron / opportunistic / boot-only).
 *
 * Module graph fully mocked (the boot-resilience.test.ts shape): every
 * job module resolves to controllable stubs, so the suite exercises
 * ONLY the chain's failure handling — no DB, no watchers, no locks.
 */

const { failingJobs, jobCalls } = vi.hoisted(() => ({
  /** Names (chain labels) whose stub must reject this run. */
  failingJobs: new Set<string>(),
  /** Execution order witness — proves the chain survives failures. */
  jobCalls: [] as string[],
}));

/** A chain-labelled job stub: records the visit, rejects if opted in. */
function stub(name: string) {
  return vi.fn(async () => {
    jobCalls.push(name);
    if (failingJobs.has(name)) throw new Error(`${name} boot failure (test)`);
  });
}

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../lib/sentry", () => ({
  captureSchedulerFailure: vi.fn(),
}));

vi.mock("../../lib/admin-session", () => ({
  pruneStaleAdminSessions: stub("admin-session-prune"),
}));
vi.mock("../couponWatcher", () => ({
  checkExpiringCoupons: stub("coupon-sweep"),
}));
vi.mock("../cleanup-auth-activity", () => ({
  cleanupOldAuthActivity: stub("auth-activity-retention"),
}));
vi.mock("../security-advisories", () => ({
  checkAdminTotpAdvisory: stub("security-advisories"),
}));
vi.mock("../session-prune", () => ({
  pruneExpiredSessions: stub("session-prune"),
}));
vi.mock("../risk-retention", () => ({
  reapExpiredRiskEvents: stub("risk-retention"),
}));
// The alert-retention chain entry awaits BOTH alertLogger helpers — the
// second only runs if the first didn't throw, so it must NOT record its
// own visit (the entry is counted once, under the chain label).
vi.mock("../alertLogger", () => ({
  markStaleUnreadAlertsRead: stub("alert-retention"),
  pruneReadAlerts: vi.fn(async () => 0),
}));
vi.mock("../flashSaleWatcher", () => ({
  deactivateExpiredFlashSales: stub("flash-sale-catchup"),
}));
vi.mock("../stockWatcher", () => ({
  runStockSweep: stub("stock-sweep"),
  reportOrphanInventory: stub("orphan-inventory-report"),
}));
vi.mock("../copilot-reaper", () => ({
  reapExpiredCopilotPreviews: stub("copilot-reaper"),
}));
vi.mock("../../services/whatsapp-otp.service", () => ({
  pruneExpiredOtps: stub("whatsapp-otp-prune"),
}));
vi.mock("../idempotency-retention", () => ({
  pruneOldIdempotencyKeys: stub("idempotency-retention"),
}));
vi.mock("../notifications-retention", () => ({
  pruneOldNotifications: stub("notifications-retention"),
}));
vi.mock("../auth-audit-retention", () => ({
  pruneStaleLoginAttempts: stub("login-attempts-retention"),
  pruneOldAuditLogs: stub("audit-logs-retention"),
}));
vi.mock("../reencrypt-v1-credentials", () => ({
  reencryptV1CredentialBlobs: stub("reencrypt-v1-credentials"),
}));

import { runBootOneShots } from "../boot-one-shots";
import { captureSchedulerFailure } from "../../lib/sentry";
import { logger } from "../../lib/logger";

const captureSpy = vi.mocked(captureSchedulerFailure);
const warnSpy = vi.mocked(logger.warn);

/** The 17-entry roster (CHAIN ORDER) with the retry kind each label must report. */
const ROSTER: Record<string, "cron" | "opportunistic" | "boot-only"> = {
  "session-prune": "cron",
  "security-advisories": "cron",
  "alert-retention": "cron",
  "risk-retention": "cron",
  "auth-activity-retention": "cron",
  "idempotency-retention": "cron",
  "notifications-retention": "cron",
  "login-attempts-retention": "cron",
  "audit-logs-retention": "cron",
  "coupon-sweep": "opportunistic",
  "stock-sweep": "opportunistic",
  "orphan-inventory-report": "boot-only",
  "copilot-reaper": "opportunistic",
  "whatsapp-otp-prune": "opportunistic",
  "admin-session-prune": "cron",
  "flash-sale-catchup": "opportunistic",
  "reencrypt-v1-credentials": "boot-only",
};

const MESSAGE_FRAGMENT: Record<string, RegExp> = {
  cron: /will retry at its next cron slot/,
  opportunistic: /no cron slot — will retry on its next throttled traffic trigger or next boot/,
  "boot-only": /boot-only — will retry on the next boot\/deploy/,
};

beforeEach(() => {
  failingJobs.clear();
  jobCalls.length = 0;
  captureSpy.mockReset();
  warnSpy.mockReset();
});

describe("R127-L3 (B7 P3-1) — boot one-shot failure capture + retry truth", () => {
  it("a failing one-shot is captured to Sentry with the boot_one_shot trigger", async () => {
    failingJobs.add("session-prune");
    runBootOneShots();

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const [name, err, extras] = captureSpy.mock.calls[0];
    expect(name).toBe("session-prune");
    expect((err as Error).message).toContain("boot failure (test)");
    expect(extras).toEqual({ trigger: "boot_one_shot" });
  });

  it("one failure never skips its siblings — the whole 17-entry chain runs", async () => {
    failingJobs.add("session-prune");
    runBootOneShots();

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));
    // 17 visits recorded, including every sibling AFTER the failure —
    // the sequential chain catches per-entry and keeps walking.
    expect(jobCalls).toHaveLength(17);
    expect(jobCalls[jobCalls.length - 1]).toBe("reencrypt-v1-credentials");
  });

  it("the retry message is per-kind TRUTHFUL: all 17 fail, each says what actually retries it", async () => {
    for (const name of Object.keys(ROSTER)) failingJobs.add(name);
    runBootOneShots();

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(17));

    // Every captured name is a roster entry, exactly once (order is the
    // sequential chain's, but the pin is set-equality: each label once).
    const capturedNames = captureSpy.mock.calls.map(([name]) => name);
    expect([...capturedNames].sort()).toEqual(Object.keys(ROSTER).sort());

    // Every warn carries the kind-correct message fragment + binding.
    expect(warnSpy).toHaveBeenCalledTimes(17);
    for (const call of warnSpy.mock.calls) {
      const [bindings, message] = call as [{ retryKind?: string }, string];
      const name = String(message).match(/^\[scheduler\] (\S+) boot one-shot failed/)?.[1];
      expect(name, `unparseable warn message: ${String(message)}`).toBeTruthy();
      const kind = ROSTER[name!];
      expect(bindings.retryKind).toBe(kind);
      expect(String(message)).toMatch(MESSAGE_FRAGMENT[kind]);
      // The old blanket promise — false for 7 of 17 — is gone.
      expect(String(message)).not.toContain("will run again at its cron slot");
    }

    // And the classification itself: 10 cron-twins, 5 opportunistic,
    // 2 boot-only (B7 §2 inventory).
    const kinds = Object.values(ROSTER);
    expect(kinds.filter((k) => k === "cron")).toHaveLength(10);
    expect(kinds.filter((k) => k === "opportunistic")).toHaveLength(5);
    expect(kinds.filter((k) => k === "boot-only")).toHaveLength(2);
  });
});
