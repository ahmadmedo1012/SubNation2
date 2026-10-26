/**
 * flashSaleWatcher — the sale-expiry authority, behaviorally tested.
 *
 * Pre-existing coverage was wiring-only: the sweep's CALLERS were pinned
 * (lib/__tests__/web-scheduler-single-instance + web-scheduler-demotion
 * vi.mock it; jobs/__tests__/boot-one-shot-failure-capture stubs it) —
 * the sweep's own DB contract had zero direct tests.
 *
 * Contract under test (jobs/flashSaleWatcher.ts):
 *   - the sweep flips ONLY rows with is_active=true AND ends_at < now
 *     (the exact write: UPDATE flash_sales SET is_active=false WHERE
 *     is_active=true AND ends_at < now — idempotent, re-applies its own
 *     predicate, so concurrent triggers cannot race destructively);
 *   - one logAdminAlert per expired row (type flash_sale_expired,
 *     dedupeKey flash_sale_expired:<id>, 7-day window) — asserted via
 *     the admin_alerts rows, per the alert-hygiene exemplar: the socket
 *     fan-out inside logAdminAlert is fire-and-forget failure-isolated,
 *     so no vi.mock is required;
 *   - the follow-on display/listing state converges: the catalog list
 *     loader (services/catalog.service.ts loadProductList — the R136
 *     extraction home) serves NO sale pricing once the sweep ran, and
 *     still serves it while a sale is genuinely live (the control that
 *     makes "gone" meaningful).
 *
 * Determinism: ends_at is seeded ±2h around the real clock — the sweep
 * predicate (ends_at < now) is invariant at that margin, so no fake
 * timers are needed (same convention as the sibling coupon-watcher
 * suite's ±2h/±5d fixtures).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminAlertsTable,
  db,
  flashSalesTable,
  initTestDb,
  inventoryTable,
  productsTable,
  resetTestDb,
} from "../../test/db";
import { deactivateExpiredFlashSales } from "../flashSaleWatcher";
import { loadProductList } from "../../services/catalog.service";

const HOURS = 60 * 60 * 1000;

/** The list-loader param shape the public GET / route passes. */
const LIST_PARAMS = {
  category: undefined,
  search: undefined,
  hasSearch: false,
  availableOnly: false,
  sort: undefined,
  listView: false,
};

async function seedProduct(price = "100.00") {
  const [p] = await db.insert(productsTable).values({ name: "FSW Product", price }).returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "acct@fsw.local",
    accountPassword: "pw-fsw",
  });
  return p;
}

async function seedSale(endsAt: Date, isActive = true, title = "FSW Sale") {
  const [sale] = await db
    .insert(flashSalesTable)
    .values({ title, discountPercent: "20.00", endsAt, isActive })
    .returning();
  return sale;
}

async function saleRow(id: number) {
  const [row] = await db.select().from(flashSalesTable).where(eq(flashSalesTable.id, id));
  return row;
}

async function firstListedProduct() {
  const rows = await loadProductList(LIST_PARAMS);
  expect(rows).toHaveLength(1); // the seeded product is the whole catalog
  return rows[0];
}

beforeAll(async () => {
  // 30s hook budget (coupon-watcher-gate exemplar): initTestDb builds the
  // full pglite DDL — under a contended sandbox that exceeds the 10s default.
  await initTestDb();
}, 30_000);
beforeEach(async () => {
  await resetTestDb();
});

describe("flashSaleWatcher — expired-sale sweep (the deactivation authority)", () => {
  it("deactivates an expired active sale, alerts exactly once, and the catalog converges to list pricing", async () => {
    await seedProduct("100.00");
    const sale = await seedSale(new Date(Date.now() - 2 * HOURS));

    await deactivateExpiredFlashSales();

    // The exact write the job performs: the row's is_active flag flips.
    expect((await saleRow(sale.id)).isActive).toBe(false);

    // One operator alert, keyed per sale (7-day dedupe — a sale can never
    // expire again, so one alert per sale is the truth).
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("flash_sale_expired");
    expect(alerts[0].dedupeKey).toBe(`flash_sale_expired:${sale.id}`);
    expect(alerts[0].title).toBe("انتهت تخفيضات: FSW Sale");
    // R188-3 (D-F13): the expiry is localized exactly like couponWatcher's
    // expiry line (ar-LY / Africa/Tripoli, Latin digits) — a raw ISO
    // timestamp bidi-scrambles inside the RTL alert line.
    const endsAt = (await saleRow(sale.id)).endsAt;
    expect(alerts[0].message).toBe(
      `تم إنهاء التخفيضات تلقائياً بعد انتهاء وقتها (${endsAt.toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" })}).`,
    );
    expect(alerts[0].message).not.toContain(endsAt.toISOString());

    // The sweep is idempotent: a second run neither re-flips (already
    // false — the UPDATE re-applies its own predicate) nor re-alerts.
    await deactivateExpiredFlashSales();
    expect((await saleRow(sale.id)).isActive).toBe(false);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(1);

    // Display/listing convergence: the catalog list loader serves NO sale
    // pricing post-sweep — list price only, no sale_price, no badge pct.
    const listed = await firstListedProduct();
    expect(listed.price).toBe(100);
    expect(listed.sale_price).toBeNull();
    expect(listed.discount_percent).toBeNull();
  });

  it("a LIVE sale is never touched — and the list loader still serves its sale pricing", async () => {
    await seedProduct("100.00");
    const sale = await seedSale(new Date(Date.now() + 2 * HOURS));

    await deactivateExpiredFlashSales();

    expect((await saleRow(sale.id)).isActive).toBe(true);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);

    // The control: while the sale is live the loader DOES discount —
    // proving the previous test's "sale pricing gone" is the sweep's
    // doing, not a loader blind to flash sales.
    const listed = await firstListedProduct();
    expect(listed.price).toBe(100);
    expect(listed.sale_price).toBe(80); // 100 × (1 − 20%)
    expect(listed.discount_percent).toBe(20);
  });

  it("an already-deactivated expired sale is left alone and never alerted", async () => {
    await seedProduct("100.00");
    const sale = await seedSale(new Date(Date.now() - 2 * HOURS), false);

    await deactivateExpiredFlashSales();

    expect((await saleRow(sale.id)).isActive).toBe(false);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
  });

  it("a sweep with nothing expired is a clean no-op (no rows, no alerts)", async () => {
    await seedProduct("100.00");
    await seedSale(new Date(Date.now() + 24 * HOURS));

    await deactivateExpiredFlashSales();

    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
    const [live] = await db.select().from(flashSalesTable);
    expect(live.isActive).toBe(true);
  });

  it("multiple expired sales flip in ONE sweep, one deduped alert each", async () => {
    await seedProduct("100.00");
    const a = await seedSale(new Date(Date.now() - 2 * HOURS), true, "FSW Sale A");
    const b = await seedSale(new Date(Date.now() - 5 * HOURS), true, "FSW Sale B");

    await deactivateExpiredFlashSales();

    expect((await saleRow(a.id)).isActive).toBe(false);
    expect((await saleRow(b.id)).isActive).toBe(false);
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((r) => r.dedupeKey))).toEqual(
      new Set([`flash_sale_expired:${a.id}`, `flash_sale_expired:${b.id}`]),
    );
  });
});
