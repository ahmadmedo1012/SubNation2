import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  couponsTable,
  sessionsTable,
  usersTable,
  authActivityTable,
} from "../../test/db";
import { cleanupOldAuthActivity } from "../cleanup-auth-activity";
import { pruneExpiredSessions } from "../session-prune";
import { pruneReadAlerts, markStaleUnreadAlertsRead } from "../alertLogger";
import { checkExpiringCoupons, resetCouponWatcherMemoryForTests } from "../couponWatcher";

/**
 * Round-92 B7 jobs tests:
 *
 *   - B7-P2-5: retention DELETEs run in bounded ctid batches (1000 rows
 *     per statement) instead of single unbounded DELETEs — exercised with
 *     >1000-row datasets so the loop MUST iterate to completion. Datasets
 *     are kept just above the batch size (1010): the loop boundary is what
 *     is under test, and this suite shares a 2-CPU sandbox with ~50 other
 *     pglite-instantiating files — every extra 1000 rows of INSERT work
 *     here is CPU stolen from some other file's 10 s beforeAll hook.
 *   - B7-P1-2: cleanupOldAuthActivity finally has a caller AND a test —
 *     the auth_activity table doesn't exist in the shared harness DDL, so
 *     this file provisions it locally (per-file pglite instance).
 *   - B7-P2-1: couponWatcher alerts carry the `coupon:expiring:{id}`
 *     dedupeKey — the restart-duplicate alert class round-5 fixed for
 *     stock alerts.
 */

// 1010 rows: full batch (1000) + remainder (10) — forces ≥2 loop
// iterations without wasting CPU on rows the boundary test doesn't need.
const BATCH_BOUNDARY_ROWS = 1010;

beforeAll(async () => {
  await initTestDb();
  // auth_activity is not part of the shared harness DDL — create the
  // production shape locally (this file's pglite instance is isolated).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_activity (
      id              serial PRIMARY KEY,
      user_id         integer,
      identifier      varchar(255) NOT NULL,
      action          varchar(50) NOT NULL,
      provider        varchar(50),
      success         boolean NOT NULL,
      ip_address      varchar(45),
      user_agent      text,
      failure_reason  varchar(255),
      created_at      timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Explicit hook timeout — same 2-CPU full-suite contention rationale
  // as migrate-v1m9.test.ts.
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE TABLE auth_activity RESTART IDENTITY"));
});

describe("cleanupOldAuthActivity — 90-day retention, batched (B7-P2-5)", () => {
  it("deletes >1000 stale rows through the batch loop and keeps fresh ones", async () => {
    await db.execute(sql`
      INSERT INTO auth_activity (identifier, action, success, created_at)
      SELECT 'user-1', 'login', true, now() - interval '100 days'
      FROM generate_series(1, ${BATCH_BOUNDARY_ROWS})
    `);
    await db.execute(sql`
      INSERT INTO auth_activity (identifier, action, success)
      VALUES ('fresh-user', 'login', true)
    `);

    const deleted = await cleanupOldAuthActivity();

    expect(deleted).toBe(BATCH_BOUNDARY_ROWS);
    const remaining = await db.select().from(authActivityTable);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].identifier).toBe("fresh-user");
  });

  it("returns 0 (and exits after one short batch) when nothing is stale", async () => {
    await db.execute(sql`
      INSERT INTO auth_activity (identifier, action, success)
      VALUES ('only-fresh', 'login', true)
    `);
    expect(await cleanupOldAuthActivity()).toBe(0);
  });
});

describe("pruneExpiredSessions — batched (B7-P2-5)", () => {
  it("deletes >1000 expired sessions in batches and keeps live ones", async () => {
    await db.insert(usersTable).values({ id: 1, phone: "091100000" });
    await db.execute(sql`
      INSERT INTO sessions (id, user_id, expires_at)
      SELECT 'sess-old-' || g, 1, now() - interval '1 hour'
      FROM generate_series(1, ${BATCH_BOUNDARY_ROWS}) g
    `);
    await db.insert(sessionsTable).values({
      id: "sess-live",
      userId: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const removed = await pruneExpiredSessions();

    expect(removed).toBe(BATCH_BOUNDARY_ROWS);
    const left = await db.select().from(sessionsTable);
    expect(left.map((s) => s.id)).toEqual(["sess-live"]);
  });
});

describe("pruneReadAlerts — batched (B7-P2-5)", () => {
  it("deletes >1000 old read alerts in batches and keeps everything else", async () => {
    await db.execute(sql`
      INSERT INTO admin_alerts (type, title, message, is_read, created_at)
      SELECT 'system', 'old-alert-' || g, 'm', true, now() - interval '40 days'
      FROM generate_series(1, ${BATCH_BOUNDARY_ROWS}) g
    `);
    await db.execute(sql`
      INSERT INTO admin_alerts (type, title, message, is_read, created_at)
      VALUES ('system', 'old-unread', 'm', false, now() - interval '40 days')
    `);
    await db.execute(sql`
      INSERT INTO admin_alerts (type, title, message, is_read)
      VALUES ('system', 'fresh-read', 'm', true)
    `);

    const deleted = await pruneReadAlerts(30);

    expect(deleted).toBe(BATCH_BOUNDARY_ROWS);
    const left = await db.select().from(adminAlertsTable);
    expect(left.map((a) => a.title).sort()).toEqual(["fresh-read", "old-unread"]);
  });
});

describe("markStaleUnreadAlertsRead — unchanged semantics", () => {
  it("still marks only unread+stale rows", async () => {
    await db.insert(adminAlertsTable).values([
      { type: "system", title: "stale", message: "m", isRead: false },
      { type: "system", title: "fresh", message: "m", isRead: false },
    ]);
    await db.execute(
      sql`UPDATE admin_alerts SET created_at = now() - interval '20 days' WHERE title = 'stale'`,
    );
    expect(await markStaleUnreadAlertsRead(14)).toBe(1);
    const stale = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.title, "stale"));
    expect(stale[0].isRead).toBe(true);
  });
});

describe("couponWatcher — dedupeKey on expiring coupons (B7-P2-1)", () => {
  it("alerts with dedupeKey coupon:expiring:{id} so restarts cannot re-spam", async () => {
    resetCouponWatcherMemoryForTests();
    await db.insert(couponsTable).values({
      code: "EXPIRE24",
      type: "percentage",
      value: "10.00",
      isActive: true,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // inside the 24h window
    });

    await checkExpiringCoupons();

    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("coupon_expiring");
    expect(alerts[0].dedupeKey).toBe("coupon:expiring:1");

    // Cold-restart simulation: the in-memory Set is gone (fresh process),
    // the alert row is 1h old — only the DB-level dedupeKey can suppress
    // the re-insert. This is the exact regression class (every Render
    // restart re-alerted Telegram + the drawer for coupons in their
    // 24h expiry window) that B7-P2-1 fixes.
    resetCouponWatcherMemoryForTests();
    await checkExpiringCoupons();
    expect((await db.select().from(adminAlertsTable)).length).toBe(1);
  });

  it("does not alert for coupons outside the 24h expiry window", async () => {
    resetCouponWatcherMemoryForTests();
    await db.insert(couponsTable).values({
      code: "LATER",
      type: "percentage",
      value: "10.00",
      isActive: true,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    await checkExpiringCoupons();
    expect((await db.select().from(adminAlertsTable)).length).toBe(0);
  });
});
