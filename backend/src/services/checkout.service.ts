import {
  couponsTable,
  db,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { computePricing, isAppliedCoupon, isInvalidCoupon } from "../lib/pricing";
import { generateOrderCode } from "../lib/crypto";
import { insertLedgerEntry } from "../lib/ledger";
import { logAdminAlert } from "../jobs/alertLogger";
import { notifyCouponMaxedOut } from "../telegram";
import { computeTier } from "../lib/loyalty-tiers";
import { toNumber } from "../lib/numeric";

/**
 * Checkout service — the single owner of the purchase flow.
 *
 * Encapsulates the full sequence the route used to inline:
 *   product lookup → discount stack (flash sale → coupon) → user + balance
 *   check → inventory availability → ATOMIC transaction (inventory claim +
 *   optimistic wallet deduction + loyalty + coupon use + order + ledger).
 *
 * Returns a discriminated result so the HTTP layer maps `reason` → status
 * code + localized message (keeping responses byte-identical to the previous
 * inline handler), and tests can assert the exact production path.
 *
 * Business rules are UNCHANGED — the transaction body is moved verbatim.
 */

export type CheckoutFailureReason =
  | "PRODUCT_NOT_FOUND"
  | "INVALID_COUPON"
  | "USER_NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "OUT_OF_STOCK"
  | "INVENTORY_CLAIMED"
  | "COUPON_EXHAUSTED"
  // H5 (deep-audit 2026-09-06): the optimistic wallet deduction lost a
  // race (e.g. a concurrent topup-approval + purchase). Previously this
  // escaped as a raw 500 on the most money-sensitive endpoint; now it is
  // a first-class 409-retryable failure.
  | "CONCURRENCY_ERROR"
  // M1 (round-3 audit): final-price integrity gate tripped — the computed
  // price is non-finite or non-positive. Fail closed, never transact.
  | "INVALID_PRICE";

export type CheckoutResult =
  | {
      ok: true;
      order: typeof ordersTable.$inferSelect;
      product: typeof productsTable.$inferSelect;
      user: typeof usersTable.$inferSelect;
      finalPrice: number;
    }
  | { ok: false; reason: CheckoutFailureReason; message?: string };

export interface CheckoutInput {
  userId: number;
  productId: number;
  couponCode?: string;
}

export async function purchase(input: CheckoutInput): Promise<CheckoutResult> {
  const { userId, productId } = input;
  const couponCode = input.couponCode;

  const [product] = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.id, productId),
        eq(productsTable.isActive, true),
        eq(productsTable.isArchived, false),
      ),
    )
    .limit(1);
  if (!product) return { ok: false, reason: "PRODUCT_NOT_FOUND" };

  // ── Discount stack (flash sale → coupon → final) — single source: lib/pricing.ts
  const pricing = await computePricing({
    listPrice: toNumber(product.price),
    couponCode,
  });
  if (pricing.coupon && isInvalidCoupon(pricing.coupon)) {
    return { ok: false, reason: "INVALID_COUPON", message: pricing.coupon.reasonAr };
  }

  const discountAmount = pricing.discountAmount;
  const finalPrice = pricing.finalPrice;
  const appliedCoupon = isAppliedCoupon(pricing.coupon) ? pricing.coupon.record : null;

  // ── Money-integrity gate (audit M1, defense-in-depth) ────────────────────
  // The zod perimeter now bounds product prices at write time, but the
  // checkout math is the last line of defense for every unit sold. A
  // non-finite or non-positive final price here means either a legacy
  // bad row, a future schema bypass, or a pricing regression — any of
  // which would flip the balance comparison below and CREDIT the
  // wallet on a purchase (finalPrice < 0 makes `currentBalance <
  // finalPrice` false and `newBalance = balance - (negative)` adds
  // funds). Fail closed with an explicit reason instead.
  if (!Number.isFinite(finalPrice) || finalPrice <= 0 || !Number.isFinite(discountAmount) || discountAmount < 0) {
    return { ok: false, reason: "INVALID_PRICE" };
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return { ok: false, reason: "USER_NOT_FOUND" };

  const currentBalance = toNumber(user.walletBalance);
  if (currentBalance < finalPrice) return { ok: false, reason: "INSUFFICIENT_BALANCE" };

  // Cheap lock-free OUT_OF_STOCK fast-fail — the authoritative,
  // race-free selection happens INSIDE the transaction with
  // FOR UPDATE SKIP LOCKED (H4).
  const [inventoryFastCheck] = await db
    .select({ id: inventoryTable.id })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
    .limit(1);
  if (!inventoryFastCheck) return { ok: false, reason: "OUT_OF_STOCK" };

  // ── Atomic transaction: inventory claim + balance deduction + coupon + order ──
  const newBalance = +(currentBalance - finalPrice).toFixed(2);
  const now = new Date();
  const order = await db
    .transaction(async (tx) => {
      // H4 (deep-audit 2026-09-06): race-free inventory claim. The old
      // flow selected one row OUTSIDE the transaction with no ORDER BY —
      // two concurrent buyers grabbed the SAME row, one won the claim,
      // and the loser saw a false 409 "claimed" while identical units
      // sat unsold. FOR UPDATE SKIP LOCKED inside the transaction makes
      // each buyer take a DIFFERENT row (locked rows are skipped), and
      // ORDER BY id keeps the pick deterministic.
      const [lockedInventory] = await tx
        .select()
        .from(inventoryTable)
        .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
        .orderBy(inventoryTable.id)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!lockedInventory) throw new Error("OUT_OF_STOCK");

      const inventoryItem = lockedInventory;

      // Atomic inventory claim inside transaction to prevent race conditions
      const [inv] = await tx
        .update(inventoryTable)
        .set({ isSold: true, soldAt: now })
        .where(and(eq(inventoryTable.id, inventoryItem.id), eq(inventoryTable.isSold, false)))
        .returning();
      if (!inv) throw new Error("INVENTORY_CLAIMED");

      const newLifetimeSpend = +(toNumber(user.lifetimeSpend) + finalPrice).toFixed(2);
      const [updatedUser] = await tx
        .update(usersTable)
        .set({
          walletBalance: String(newBalance),
          lifetimeSpend: String(newLifetimeSpend),
          loyaltyPoints: user.loyaltyPoints + Math.floor(finalPrice),
          loyaltyTier: computeTier(newLifetimeSpend),
        })
        // r4 money-integrity M3: extend the optimistic lock beyond
        // walletBalance to loyaltyPoints + lifetimeSpend. The user row
        // was read OUTSIDE this transaction, so those columns are stale
        // by the time this UPDATE runs. A concurrent operation that
        // touches ONLY points (referral +50, admin points-set) left the
        // walletBalance predicate intact — the stale values silently
        // erased the concurrent award (points are LYD-convertible at
        // 100:1, so this is money). All three predicates together make
        // the whole read set part of the lock; any interleaved writer
        // forces CONCURRENCY_ERROR and a client retry instead of a
        // silent lost-update. Postgres numeric equality is value-based,
        // so "100.50" = '100.5' matches regardless of stored scale.
        .where(
          and(
            eq(usersTable.id, userId),
            eq(usersTable.walletBalance, String(currentBalance)),
            eq(usersTable.loyaltyPoints, user.loyaltyPoints),
            eq(usersTable.lifetimeSpend, String(toNumber(user.lifetimeSpend))),
          ),
        )
        .returning();
      if (!updatedUser) throw new Error("CONCURRENCY_ERROR");

      if (appliedCoupon) {
        const newUsedCount = appliedCoupon.usedCount + 1;
        // F-006 (security audit 004) — atomic-with-check increment.
        //
        // Previously: validate-outside-transaction then unconditional
        // `usedCount + 1` increment inside the transaction. Two concurrent
        // checkouts of a maxUses=1 coupon both passed validation (read 0,
        // saw 0 < 1) and both incremented (final usedCount=2). The audit
        // recommendation is approach (b): make the increment atomic-with-check
        // by adding `WHERE usedCount < maxUses` to the UPDATE. If
        // rowsAffected = 0, another concurrent purchase already consumed the
        // last redemption slot — throw COUPON_EXHAUSTED and the surrounding
        // transaction rolls back the inventory claim, balance debit, etc.
        //
        // For unbounded coupons (maxUses === null), the predicate is just
        // the id match — no race exists because there is no cap.
        const couponWhere =
          appliedCoupon.maxUses === null
            ? eq(couponsTable.id, appliedCoupon.id)
            : and(
                eq(couponsTable.id, appliedCoupon.id),
                sql`${couponsTable.usedCount} < ${appliedCoupon.maxUses}`,
              );
        const [updatedCoupon] = await tx
          .update(couponsTable)
          .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
          .where(couponWhere)
          .returning();
        if (!updatedCoupon) throw new Error("COUPON_EXHAUSTED");
        if (appliedCoupon.maxUses !== null && newUsedCount >= appliedCoupon.maxUses) {
          notifyCouponMaxedOut(appliedCoupon.code, appliedCoupon.maxUses);
          logAdminAlert(
            "coupon_maxed",
            `كوبون استُنفد: ${appliedCoupon.code}`,
            `وصل الكوبون إلى الحد الأقصى من الاستخدام (${appliedCoupon.maxUses} مرة) وأُوقف تلقائياً`,
          );
        }
      }

      const [o] = await tx
        .insert(ordersTable)
        .values({
          orderCode: generateOrderCode(),
          userId,
          productId,
          inventoryId: inventoryItem.id,
          amount: String(finalPrice),
          walletBalanceBefore: String(currentBalance),
          walletBalanceAfter: String(newBalance),
          status: "completed",
          deliveredEmail: inventoryItem.accountEmail,
          // H2 (deep-audit 2026-09-06): store the password ENCRYPTED at
          // rest — the inventory value is already AES-256-GCM ciphertext,
          // so pass it through unchanged. The old code decrypted it here,
          // leaving plaintext credentials in every orders row (a DB dump
          // / backup leak = every delivered account exposed). The API
          // boundary (routes/orders.ts formatOrder) still decrypts with
          // safeDecrypt, and legacy plaintext rows pass through it
          // unchanged — no backfill needed, reads keep working.
          deliveredPassword: inventoryItem.accountPassword,
          deliveredExtraDetails: inventoryItem.extraDetails ?? null,
          deliveredUsageTerms: product.usageTerms ?? null,
          deliveredAt: now,
          couponCode: appliedCoupon?.code ?? null,
          discountAmount: String(discountAmount),
        })
        .returning();

      // Ledger entry committed atomically with balance mutation. If this
      // fails the whole purchase rolls back, keeping the audit trail in sync.
      await insertLedgerEntry(
        {
          userId,
          type: "purchase",
          amount: String(finalPrice),
          balanceBefore: String(currentBalance),
          balanceAfter: String(newBalance),
          referenceId: o.id,
          referenceType: "order",
          description: `Purchase: ${product.name}`,
        },
        tx as unknown as typeof db,
      );

      return o;
    })
    .catch((err) => {
      if (err.message === "INVENTORY_CLAIMED") {
        return { failure: "INVENTORY_CLAIMED" as const };
      }
      if (err.message === "COUPON_EXHAUSTED") {
        // F-006 — atomic-with-check coupon increment lost the race.
        return { failure: "COUPON_EXHAUSTED" as const };
      }
      if (err.message === "OUT_OF_STOCK") {
        // All remaining units were claimed between the fast-fail probe
        // and the locked in-transaction selection.
        return { failure: "OUT_OF_STOCK" as const };
      }
      if (err.message === "CONCURRENCY_ERROR") {
        // H5 — optimistic wallet deduction lost a race (concurrent
        // topup-approval / purchase / adjustment). Retryable by design.
        return { failure: "CONCURRENCY_ERROR" as const };
      }
      throw err;
    });

  if (!order) return { ok: false, reason: "INVENTORY_CLAIMED" };
  if (typeof order === "object" && "failure" in order) {
    return { ok: false, reason: order.failure };
  }

  return { ok: true, order, product, user, finalPrice };
}

export const CheckoutService = { purchase };
