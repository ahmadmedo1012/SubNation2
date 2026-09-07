import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  inventoryTable,
  productsTable,
} from "../../test/db";

// A6-P2-1 (round-93): the Telegram module is mocked so the notify-gating
// contract is observable — the whole point of these tests is that
// notifyLowStock fires ONLY when logAdminAlert reports the alert as fresh.
vi.mock("../../telegram", () => ({
  notifyLowStock: vi.fn(),
}));

import { notifyLowStock } from "../../telegram";
import { checkLowStockForTests, resetStockWatcherMemoryForTests } from "../stockWatcher";

const notifyMock = vi.mocked(notifyLowStock);

/**
 * 93-A6 P2#1 (round-93) — Telegram re-notify gating in stockWatcher.
 *
 * Live defect: notifyLowStock() was called BEFORE logAdminAlert() and its
 * dedupe outcome was never consulted, while telegram.ts's dispatch has no
 * dedupe of its own — so every Render deploy/crash/restart re-sent a
 * Telegram "🚨 نفاد المخزون" for each permanently out-of-stock product
 * (~6 messages per deploy, 6+ deploys in 2 days) even when the drawer
 * insert was correctly suppressed. Intra-session flapping
 * (0 → restock → 0 within 24h) re-fired Telegram too.
 *
 * All scenarios below run against the pglite harness with the in-memory
 * Sets reset between passes where a cold restart is simulated — the
 * DB-level dedupe key is then the only guard left, exactly like prod.
 */

beforeAll(async () => {
  await initTestDb();
}, 30_000);

beforeEach(async () => {
  await resetTestDb();
  resetStockWatcherMemoryForTests();
  notifyMock.mockClear();
});

async function seedProduct(name: string, unsoldUnits: number): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name, price: "5.00" })
    .returning({ id: productsTable.id });
  if (unsoldUnits > 0) {
    await db
      .insert(inventoryTable)
      .values(Array.from({ length: unsoldUnits }, () => ({ productId: p.id })));
  }
  return p.id;
}

describe("stockWatcher — fresh alert notifies Telegram exactly once", () => {
  it("zero stock: notify called once + drawer row with the restart-safe dedupe key", async () => {
    const pid = await seedProduct("Zero Fresh", 0);

    await checkLowStockForTests();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      productName: "Zero Fresh",
      stockCount: 0,
      productId: pid,
    });
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("no_stock");
    expect(alerts[0].dedupeKey).toBe(`stock:zero:${pid}`);
  });

  it("low stock: notify called once with the live unit count", async () => {
    const pid = await seedProduct("Low Fresh", 2);

    await checkLowStockForTests();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      productName: "Low Fresh",
      stockCount: 2,
      productId: pid,
    });
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("low_stock");
    expect(alerts[0].dedupeKey).toBe(`stock:low:${pid}`);
  });

  it("healthy stock never notifies and never logs", async () => {
    await seedProduct("Healthy", 5);

    await checkLowStockForTests();

    expect(notifyMock).not.toHaveBeenCalled();
    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
  });
});

describe("stockWatcher — suppressed alert does NOT re-ping Telegram (A6-P2-1)", () => {
  it("cold restart inside the 24h dedupe window: drawer row suppresses insert AND Telegram", async () => {
    const pid = await seedProduct("Zero Restart", 0);

    await checkLowStockForTests();
    expect(notifyMock).toHaveBeenCalledTimes(1);

    // Cold-restart simulation: the in-memory Set is gone (fresh process);
    // the DB row is minutes old. Only the dedupe key can protect the
    // operator's phone now — this is the exact regression the fix kills.
    resetStockWatcherMemoryForTests();
    await checkLowStockForTests();

    expect(notifyMock).toHaveBeenCalledTimes(1); // NOT re-pinged
    expect(await db.select().from(adminAlertsTable)).toHaveLength(1); // NOT re-inserted
  });

  it("intra-session flap (0 → restock → 0 within the window) does not re-ping", async () => {
    const pid = await seedProduct("Flap", 0);
    await checkLowStockForTests(); // zero → 1 notify + 1 row
    expect(notifyMock).toHaveBeenCalledTimes(1);

    // Restock to healthy (5 units > threshold 3) — recovery clears the
    // in-memory Sets so a future drop re-enters the alert branches.
    await db.insert(inventoryTable).values(Array.from({ length: 5 }, () => ({ productId: pid })));
    await checkLowStockForTests();
    expect(notifyMock).toHaveBeenCalledTimes(1); // no recovery ping

    // Drop back to zero inside the SAME 24h window: the DB dedupe
    // suppresses the insert, and with A6-P2-1 the Telegram send too.
    await db.update(inventoryTable).set({ isSold: true }).where(eq(inventoryTable.productId, pid));
    await checkLowStockForTests();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(1);
  });
});
