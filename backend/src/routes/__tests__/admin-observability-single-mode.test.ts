import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import type { SchedulerStateSnapshot } from "../../lib/scheduler-state";
import { adminObservabilityRouter } from "../admin/observability";

/**
 * R108 (final-hardening FH-A1 §9.8.4 — observability scheduler contract).
 *
 * GET /api/admin/observability/scheduler feeds the admin System page's
 * scheduler banner. Two R108 behaviors are pinned here:
 *
 *   1. SINGLE_INSTANCE_MODE (mode "single" + active): the single-container
 *      Oracle/Coolify target shape — the description names the أحادية
 *      mode, and in the no-Redis production shape the heartbeat is
 *      INERT BY DESIGN (`expected: false` + an explicit note) so the
 *      System page can never show a false "stale heartbeat" degradation.
 *
 *   2. THE F4 REGRESSION PIN (FH-A1 P2): before R108 `heartbeatExpected`
 *      ignored whether a Redis client exists AT ALL — with REDIS_URL
 *      unset (the Render + Oracle/Coolify production shape since r104)
 *      an embedded ACTIVE leader reported `expected: true` while the
 *      web-scheduler had (correctly) never started a heartbeat → the
 *      admin System page was permanently degraded. R108 gates the whole
 *      expectation on `redis !== null`.
 *
 * getSchedulerState/getRedisClient are mocked at the route's import
 * boundary (the real state transitions are covered by the web-scheduler
 * suites); requireAdmin is exercised for real with a seeded admin row
 * (metrics-auth pattern).
 */

vi.mock("../../lib/scheduler-state", () => ({
  getSchedulerState: vi.fn(),
}));
vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(),
}));

import { getSchedulerState } from "../../lib/scheduler-state";
import { getRedisClient } from "../../lib/redis-client";

function buildApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use("/api/admin/observability", adminObservabilityRouter);
  return app;
}

const app = buildApp();

/** A state snapshot shaped exactly like setSchedulerState writes it. */
function schedulerState(overrides: Partial<SchedulerStateSnapshot>): SchedulerStateSnapshot {
  return {
    mode: "embedded",
    active: true,
    isLeader: true,
    instanceId: "test-instance",
    reason: "active",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The route's structural Redis usage: a single GET of the heartbeat key. */
function fakeRedisWithoutHeartbeat() {
  return { get: vi.fn(async () => null) };
}

async function getScheduler(token: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/observability/scheduler`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const text = await res.text();
        resolve({ status: res.status, body: text ? JSON.parse(text) : null });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

let adminToken = "";

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  // Fresh admin per test (resetTestDb truncates admin_users — the
  // users-loyalty-guard seeding pattern).
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_observability", passwordHash: "x", isActive: true })
    .returning();
  adminToken = signAdminToken({ adminId: a.id, role: "admin" });
  vi.clearAllMocks();
});

describe("R108 — GET /api/admin/observability/scheduler (single mode + no-Redis expectation)", () => {
  it("single + active + no Redis → expected:false, note present, description names the أحادية mode", async () => {
    vi.mocked(getSchedulerState).mockReturnValue(
      schedulerState({ mode: "single", instanceId: "single-instance-1" }),
    );
    vi.mocked(getRedisClient).mockReturnValue(null);

    const { status, body } = await getScheduler(adminToken);
    expect(status).toBe(200);
    expect(body.mode).toBe("single");
    expect(body.active).toBe(true);
    expect(body.isLeader).toBe(true);
    // The economics contract: no heartbeat is expected in the no-Redis
    // single-container shape — an inert subsystem must read as inert.
    expect(body.heartbeat.expected).toBe(false);
    expect(body.heartbeat.note).toBe("no Redis — heartbeat inert by design");
    expect(body.description).toContain("أحادية");
    expect(body.description).toContain("SINGLE_INSTANCE_MODE");
  });

  it("F4 REGRESSION PIN: embedded + active + no Redis → expected:false (was permanently degraded before R108)", async () => {
    vi.mocked(getSchedulerState).mockReturnValue(schedulerState({ mode: "embedded" }));
    vi.mocked(getRedisClient).mockReturnValue(null);

    const { status, body } = await getScheduler(adminToken);
    expect(status).toBe(200);
    // Before R108 this branch was `embedded && active` → expected:true
    // with NO Redis client in existence — the System page's banner then
    // rendered "الجدولة المضمّنة تعمل لكن النبضة متأخرة" forever.
    expect(body.heartbeat.expected).toBe(false);
    expect(body.heartbeat.note).toBe("no Redis — heartbeat inert by design");
    expect(body.description).toContain("المضمّنة");
  });

  it("dedicated + no Redis → expected:false too (the redis gate covers every mode)", async () => {
    vi.mocked(getSchedulerState).mockReturnValue(
      schedulerState({
        mode: "dedicated",
        active: false,
        isLeader: false,
        reason: "disabled_by_env",
      }),
    );
    vi.mocked(getRedisClient).mockReturnValue(null);

    const { body } = await getScheduler(adminToken);
    expect(body.mode).toBe("dedicated");
    expect(body.heartbeat.expected).toBe(false);
  });

  it("single + active WITH Redis → the heartbeat is genuinely expected (expected:true)", async () => {
    vi.mocked(getSchedulerState).mockReturnValue(schedulerState({ mode: "single" }));
    vi.mocked(getRedisClient).mockReturnValue(fakeRedisWithoutHeartbeat() as never);

    const { body } = await getScheduler(adminToken);
    // The other side of the R108 gate: when Redis exists, single mode
    // DOES run the heartbeat — a missing/stale key is then a real
    // finding the banner should surface.
    expect(body.heartbeat.expected).toBe(true);
    expect(body.heartbeat.healthy).toBe(false);
    expect(body.heartbeat.note).toBeUndefined();
    expect(body.description).toContain("أحادية");
  });
});
