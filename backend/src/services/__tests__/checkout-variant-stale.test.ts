/**
 * Catalog-2026-09-20 VARIANT_STALE guard (checkout.service.ts:425-441) —
 * ZERO test references before this suite.
 *
 * The variant freshness re-check is the variant twin of F4's PRODUCT_STALE
 * guard: the variant row the price was built from (price_lyd / isActive /
 * product membership) is re-read INSIDE the purchase transaction, and any
 * drift against the pre-pricing snapshot throws VARIANT_STALE — surfacing
 * as the stable retryable envelope
 * { reason: "CONCURRENCY_ERROR", code: "VARIANT_STALE" } (deliberately
 * NOT a new CheckoutFailureReason member — same channel as PRODUCT_STALE,
 * its own code so clients can refresh the variant list specifically).
 *
 * Without the guard, an admin editing the variant between computePricing
 * and commit debited a stale per-option price (or sold a just-deactivated
 * option) silently.
 *
 * Race injection: the tx-interleave harness (helpers/tx-interleave.ts).
 * The product freshness SELECT is the transaction's FIRST read — the
 * "concurrent admin writer" commits a VARIANT mutation on the real tx
 * session right after it resolves, i.e. after pricing snapshoted the
 * variant and before the variant re-check reads it (exactly the F10
 * claim-collision window shape). The re-check then sees the drifted row.
 * Harness caveat (documented in the helper): the writer's mutation rolls
 * back with the service tx — the assertion target is the classified
 * failure + zero money movement, which is what the guard guarantees.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  pointsLedgerTable,
  productVariantsTable,
  productsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../checkout.service";
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

beforeAll(async () => {
  // 30s hook budget (coupon-watcher-gate exemplar): initTestDb builds the
  // full pglite DDL — under a contended sandbox that exceeds the 10s default.
  await initTestDb();
}, 30_000);
beforeEach(async () => {
  await resetTestDb();
});

// Deterministic seeds (no Math.random — the repo's phoneSeq convention).
let phoneSeq = 913_310_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

/** Product + one ACTIVE variant at 10.00 + one variant-scoped unit + a generic spare. */
async function seedVariantProduct() {
  const [product] = await db
    .insert(productsTable)
    .values({ name: "VSTALE Product", price: "10.00" })
    .returning();
  const [variant] = await db
    .insert(productVariantsTable)
    .values({
      productId: product.id,
      planLabel: "Family",
      durationLabel: "1 Month",
      costPrice: "2.00",
      priceLyd: "10.00",
      sortOrder: 0,
    })
    .returning();
  await db.insert(inventoryTable).values([
    {
      productId: product.id,
      variantId: variant.id,
      accountEmail: "scoped@vstale.local",
      accountPassword: "pw-scoped",
    },
    {
      productId: product.id,
      variantId: null,
      accountEmail: "generic@vstale.local",
      accountPassword: "pw-generic",
    },
  ]);
  return { product, variant };
}

/** Zero money movement: balance, orders, BOTH ledgers, inventory claim. */
async function expectFullRollback(userId: number, productId: number) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  expect(parseFloat(String(u.walletBalance))).toBe(50);
  expect(await db.select().from(ordersTable)).toHaveLength(0);
  expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  expect(await db.select().from(pointsLedgerTable)).toHaveLength(0);
  const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, productId));
  expect(inv.every((i) => !i.isSold)).toBe(true);
}

/**
 * The product freshness SELECT is the FIRST read of the purchase
 * transaction — its 3-key projection identifies it for the interleave
 * hook (same identification the F10 claim-collision test uses). The
 * writer mutates the VARIANT row in the window it opens.
 */
const isProductFreshnessSelect = (fields: unknown): boolean =>
  !!fields &&
  typeof fields === "object" &&
  Object.keys(fields as object).length === 3 &&
  "price" in (fields as object) &&
  "isActive" in (fields as object) &&
  "isArchived" in (fields as object);

async function purchaseWithInterleavedVariantMutation(
  userId: number,
  productId: number,
  variantId: number,
  mutationSql: ReturnType<typeof sql>,
) {
  const restore = interleaveWriterAfterSelect(db, {
    matchSelectFields: isProductFreshnessSelect,
    writer: async (realTx) => {
      await realTx.execute(mutationSql);
    },
  });
  try {
    return await CheckoutService.purchase({ userId, productId, variantId });
  } finally {
    restore();
  }
}

describe("VARIANT_STALE — variant freshness re-validated inside the purchase transaction", () => {
  it("price_lyd raised between pricing and the in-tx re-check → CONCURRENCY_ERROR + code VARIANT_STALE, full rollback", async () => {
    const user = await seedUser("50.00");
    const { product, variant } = await seedVariantProduct();

    const result = await purchaseWithInterleavedVariantMutation(
      user.id,
      product.id,
      variant.id,
      sql`UPDATE product_variants SET price_lyd = '20.00' WHERE id = ${variant.id}`,
    );

    // The stable retryable envelope — the buyer is told to re-price, and
    // the message is the variant-specific Arabic copy.
    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR", code: "VARIANT_STALE" });
    if (!result.ok) {
      expect(result.message).toBe(
        "تغيّر سعر الباقة المختارة أثناء إتمام الشراء. حاول مجدداً بالسعر الحالي.",
      );
    }
    await expectFullRollback(user.id, product.id);
  });

  it("variant deactivated between pricing and the in-tx re-check → VARIANT_STALE (no stale-option sale)", async () => {
    const user = await seedUser("50.00");
    const { product, variant } = await seedVariantProduct();

    const result = await purchaseWithInterleavedVariantMutation(
      user.id,
      product.id,
      variant.id,
      sql`UPDATE product_variants SET is_active = false WHERE id = ${variant.id}`,
    );

    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR", code: "VARIANT_STALE" });
    await expectFullRollback(user.id, product.id);
  });

  it("no drift → the purchase succeeds at the variant price (no false positive)", async () => {
    const user = await seedUser("50.00");
    const { product, variant } = await seedVariantProduct();

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      variantId: variant.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalPrice).toBe(10);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(40);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
  });

  it("value-based comparison: the same price at a different numeric scale is NOT stale", async () => {
    const user = await seedUser("50.00");
    const { product, variant } = await seedVariantProduct();

    // The interleaved writer commits '10.0' — numerically identical to the
    // '10.00' the price was built from. Value-based comparison (numeric
    // string → float, the wallet CAS convention) must not 409 the buyer.
    const result = await purchaseWithInterleavedVariantMutation(
      user.id,
      product.id,
      variant.id,
      sql`UPDATE product_variants SET price_lyd = '10.0' WHERE id = ${variant.id}`,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalPrice).toBe(10);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(40);
  });
});
