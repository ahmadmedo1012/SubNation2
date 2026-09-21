import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminAlertsTable,
  db,
  initTestDb,
  inventoryTable,
  productsTable,
  resetTestDb,
} from "../../test/db";
import { eq } from "drizzle-orm";
import { reportOrphanInventory } from "../stockWatcher";

/**
 * AUD103-8-F6 (r103): the R102 orphan-inventory one-shot had only a
 * wiring-level pin (the demotion test mocks the function) — the actual
 * query, the no-delete guarantee, and the 24h dedupe were unpinned. A
 * future edit (a "helpful" cleanup, or an innerJoin broken into a
 * miscounting leftJoin) would have passed CI silently.
 */

async function seedProduct(name: string, archived: boolean, units: { unsold: number; sold: number }) {
  const [p] = await db
    .insert(productsTable)
    .values({ name, price: "10.00", isArchived: archived, isActive: !archived })
    .returning();
  for (let i = 0; i < units.unsold; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `${name}-unsold-${i}@test.local`,
      accountPassword: "pw",
    });
  }
  for (let i = 0; i < units.sold; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `${name}-sold-${i}@test.local`,
      accountPassword: "pw",
      isSold: true,
      soldAt: new Date(),
    });
  }
  return p;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("reportOrphanInventory (AUD103-8-F6)", () => {
  it("alerts on unsold units under ARCHIVED products only — and deletes NOTHING", async () => {
    await seedProduct("ActiveProduct", false, { unsold: 4, sold: 1 });
    const archived = await seedProduct("ArchivedProduct", true, { unsold: 3, sold: 2 });
    const archivedEmpty = await seedProduct("ArchivedEmpty", true, { unsold: 0, sold: 1 });

    const before = await db.select({ id: inventoryTable.id }).from(inventoryTable);
    await reportOrphanInventory();

    // NO-DELETE guarantee: every row is still there, untouched.
    const after = await db.select({ id: inventoryTable.id }).from(inventoryTable);
    expect(after).toHaveLength(before.length);

    // One deduped alert, naming ONLY the archived product with unsold units.
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dedupeKey).toBe("inventory:orphan-archived");
    expect(alerts[0].title).toContain("3 وحدة");
    expect(alerts[0].message).toContain("ArchivedProduct");
    expect(alerts[0].message).toContain(`#${archived.id}`);
    // The active product's stock and the sold-out archived product are NOT flagged.
    expect(alerts[0].message).not.toContain("ActiveProduct");
    expect(alerts[0].message).not.toContain(`#${archivedEmpty.id}`);

    // …and the archived product's SOLD units did not inflate the count.
    expect(alerts[0].message).not.toContain("5 وحدة");
  });

  it("zero orphans → no alert at all", async () => {
    await seedProduct("OnlyActive", false, { unsold: 5, sold: 0 });
    await reportOrphanInventory();
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(0);
  });

  it("the 24h dedupe suppresses a second report while the alert is fresh", async () => {
    await seedProduct("ArchivedDup", true, { unsold: 2, sold: 0 });
    await reportOrphanInventory();
    await reportOrphanInventory(); // restart / re-run within the window
    const alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, "inventory:orphan-archived"));
    expect(alerts).toHaveLength(1);
  });
});
