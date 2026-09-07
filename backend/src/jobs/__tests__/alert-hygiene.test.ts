import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  adminUsersTable,
  sessionsTable,
  usersTable,
} from "../../test/db";
import {
  logAdminAlert,
  markStaleUnreadAlertsRead,
  pruneReadAlerts,
  consolidateStockAlertSpam,
  countUnreadAlerts,
  countAllAlerts,
} from "../alertLogger";
import { pruneExpiredSessions } from "../session-prune";
import { checkAdminTotpAdvisory } from "../security-advisories";

/**
 * Round-5 (db-audit 2026-09-07) tests — alert hygiene + session prune +
 * TOTP advisory. These behaviors were born from LIVE production state:
 * 321 unread duplicate stock alerts (244 no_stock / 77 low_stock for ~6
 * products, 111 older than 7 days) and a monotonically growing sessions
 * table with no reaper. The tests pin the dedupe/retention contracts so
 * a future refactor can't quietly regress the drawer back to spam.
 *
 * The logAdminAlert socket fan-out is fire-and-forget with a dynamic
 * import of ../lib/socket — in the test graph that import either fails
 * or no-ops; either way it is caught and logged, never rethrown, so no
 * mocking is required (same reliance-on-failure-isolation as the
 * checkout service tests).
 */

beforeAll(initTestDb);
beforeEach(resetTestDb);

async function seedUser(id = 1) {
  await db.insert(usersTable).values({ id, phone: `091${id}00000` });
}

async function alertCount(): Promise<number> {
  return countAllAlerts();
}

async function backdateAlert(id: number, days: number): Promise<void> {
  await db.execute(
    sql`UPDATE admin_alerts SET created_at = now() - (${days} || ' days')::interval WHERE id = ${id}`,
  );
}

describe("logAdminAlert dedupe (Round-5)", () => {
  it("inserts the first alert with a dedupe key", async () => {
    await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    expect(await alertCount()).toBe(1);
    expect(await countUnreadAlerts()).toBe(1);
  });

  it("suppresses a second insert within the dedupe window", async () => {
    await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    // The cold-start-restart scenario: 3 calls, 1 row.
    expect(await alertCount()).toBe(1);
  });

  it("inserts again once the window has elapsed", async () => {
    await logAdminAlert("low_stock", "مخزون منخفض: A", "m", {
      dedupeKey: "stock:low:1",
      dedupeWindowMs: 60 * 1000, // 1 minute — small window for the test
    });
    const [first] = await db.select().from(adminAlertsTable).limit(1);
    await backdateAlert(first.id, 1); // older than the 1-minute window
    await logAdminAlert("low_stock", "مخزون منخفض: A", "m", {
      dedupeKey: "stock:low:1",
      dedupeWindowMs: 60 * 1000,
    });
    expect(await alertCount()).toBe(2);
  });

  it("different keys never suppress each other", async () => {
    await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    await logAdminAlert("no_stock", "نفاد المخزون: B", "m", {
      dedupeKey: "stock:zero:2",
    });
    expect(await alertCount()).toBe(2);
  });

  it("alerts without a dedupe key always insert (one-off contract)", async () => {
    await logAdminAlert("system", "تنبيه 1", "m");
    await logAdminAlert("system", "تنبيه 2", "m");
    expect(await alertCount()).toBe(2);
  });
});

describe("alert retention (Round-5 daily 00:00 job)", () => {
  it("auto-marks unread alerts read past the staleness horizon", async () => {
    await logAdminAlert("system", "قديم", "m");
    const [row] = await db.select().from(adminAlertsTable).limit(1);
    await backdateAlert(row.id, 20); // 20 days old, unread
    const staled = await markStaleUnreadAlertsRead(14);
    expect(staled).toBe(1);
    expect(await countUnreadAlerts()).toBe(0);
  });

  it("leaves fresh unread alerts untouched", async () => {
    await logAdminAlert("system", "جديد", "m");
    await markStaleUnreadAlertsRead(14);
    expect(await countUnreadAlerts()).toBe(1);
  });

  it("prunes read alerts older than the retention horizon", async () => {
    await logAdminAlert("system", "مقروء قديم", "m");
    const [row] = await db.select().from(adminAlertsTable).limit(1);
    await backdateAlert(row.id, 40);
    await db
      .update(adminAlertsTable)
      .set({ isRead: true })
      .where(eq(adminAlertsTable.id, row.id));
    const pruned = await pruneReadAlerts(30);
    expect(pruned).toBe(1);
    expect(await alertCount()).toBe(0);
  });

  it("keeps read alerts inside the horizon", async () => {
    await logAdminAlert("system", "مقروء حديث", "m");
    const [row] = await db.select().from(adminAlertsTable).limit(1);
    await db
      .update(adminAlertsTable)
      .set({ isRead: true })
      .where(eq(adminAlertsTable.id, row.id));
    expect(await pruneReadAlerts(30)).toBe(0);
    expect(await alertCount()).toBe(1);
  });
});

describe("consolidateStockAlertSpam (V1-M8 backfill)", () => {
  it("collapses duplicate no_stock/low_stock rows to the newest per (type,title)", async () => {
    // Reproduce the production shape: 5 duplicates for product A,
    // 3 for product B, 1 for product C.
    for (let i = 0; i < 5; i++)
      await db.insert(adminAlertsTable).values({
        type: "no_stock",
        title: "نفاد المخزون: A",
        message: "m",
      });
    for (let i = 0; i < 3; i++)
      await db.insert(adminAlertsTable).values({
        type: "low_stock",
        title: "مخزون منخفض: B",
        message: "m",
      });
    await db
      .insert(adminAlertsTable)
      .values({ type: "no_stock", title: "نفاد المخزون: C", message: "m" });

    const removed = await consolidateStockAlertSpam();

    expect(removed).toBe(6); // 9 rows → 3 survivors
    expect(await alertCount()).toBe(3);
    // The survivor is the NEWEST row per group (max id).
    const remaining = await db.select().from(adminAlertsTable);
    const ids = remaining.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toContain(5); // newest no_stock:A (id 5)
    expect(ids).toContain(8); // newest low_stock:B (id 8)
    expect(ids).toContain(9); // the single no_stock:C
  });

  it("never touches non-stock alert types", async () => {
    await db.insert(adminAlertsTable).values([
      { type: "system", title: "تنبيه نظامي", message: "m" },
      { type: "system", title: "تنبيه نظامي", message: "m" },
      { type: "coupon_maxed", title: "WELCOME10", message: "m" },
      { type: "coupon_maxed", title: "WELCOME10", message: "m" },
    ]);
    expect(await consolidateStockAlertSpam()).toBe(0);
    expect(await alertCount()).toBe(4);
  });

  it("is idempotent — a second run is a no-op", async () => {
    for (let i = 0; i < 4; i++)
      await db
        .insert(adminAlertsTable)
        .values({ type: "no_stock", title: "نفاد المخزون: A", message: "m" });
    await consolidateStockAlertSpam();
    expect(await consolidateStockAlertSpam()).toBe(0);
    expect(await alertCount()).toBe(1);
  });
});

describe("pruneExpiredSessions (Round-5 daily 05:00 job)", () => {
  it("deletes expired sessions and keeps live ones", async () => {
    await seedUser(1);
    await db.insert(sessionsTable).values([
      {
        id: "sess-expired",
        userId: 1,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        id: "sess-live",
        userId: 1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ]);
    const removed = await pruneExpiredSessions();
    expect(removed).toBe(1);
    const left = await db.select().from(sessionsTable);
    expect(left.map((s) => s.id)).toEqual(["sess-live"]);
  });

  it("returns 0 when there is nothing to prune (no-error contract)", async () => {
    await seedUser(2);
    await db.insert(sessionsTable).values({
      id: "sess-live-2",
      userId: 2,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(await pruneExpiredSessions()).toBe(0);
  });
});

describe("checkAdminTotpAdvisory (Round-5 boot advisory)", () => {
  async function seedAdmin(
    overrides: Partial<{ username: string; totp: boolean; permissions: string[] }> = {},
  ) {
    const { username = "root", totp = false, permissions = ["all"] } = overrides;
    await db.insert(adminUsersTable).values({
      username,
      passwordHash: "x",
      permissions,
      totpEnabled: totp,
    });
  }

  it("alerts once for an active [\"all\"] admin without TOTP, then dedupes for 7 days", async () => {
    await seedAdmin({ username: "ahmad", totp: false });
    await checkAdminTotpAdvisory();
    expect(await countAllAlerts()).toBe(1);
    // Second call inside the weekly window — suppressed.
    await checkAdminTotpAdvisory();
    expect(await countAllAlerts()).toBe(1);
    const [alert] = await db.select().from(adminAlertsTable);
    expect(alert.type).toBe("system");
    expect(alert.dedupeKey).toBe("admin:no-totp");
    expect(alert.title).toContain("ahmad");
  });

  it("stays silent when every [\"all\"] admin has TOTP enabled", async () => {
    await seedAdmin({ username: "safe", totp: true });
    await checkAdminTotpAdvisory();
    expect(await countAllAlerts()).toBe(0);
  });

  it("stays silent for scoped admins (bounded blast radius)", async () => {
    await seedAdmin({ username: "scoped", totp: false, permissions: ["orders"] });
    await checkAdminTotpAdvisory();
    expect(await countAllAlerts()).toBe(0);
  });

  it("stays silent for inactive admins", async () => {
    await db.insert(adminUsersTable).values({
      username: "disabled",
      passwordHash: "x",
      permissions: ["all"],
      isActive: false,
    });
    await checkAdminTotpAdvisory();
    expect(await countAllAlerts()).toBe(0);
  });
});
