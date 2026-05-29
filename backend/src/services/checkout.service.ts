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
import { safeDecrypt } from "../lib/encryption";
import { insertLedgerEntry } from "../lib/ledger";
import { logAdminAlert } from "../jobs/alertLogger";
import { notifyCouponMaxedOut } from "../telegram";
import { computeTier } from "../routes/loyalty";

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
  | "INVENTORY_CLAIMED";

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
    listPrice: parseFloat(String(product.price)),
    couponCode,
  });
  if (pricing.coupon && isInvalidCoupon(pricing.coupon)) {
    return { ok: false, reason: "INVALID_COUPON", message: pricing.coupon.reasonAr };
  }

  const discountAmount = pricing.discountAmount;
  const finalPrice = pricing.finalPrice;
  const appliedCoupon = isAppliedCoupon(pricing.coupon) ? pricing.coupon.record : null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return { ok: false, reason: "USER_NOT_FOUND" };

  const currentBalance = parseFloat(String(user.walletBalance));
  if (currentBalance < finalPrice) return { ok: false, reason: "INSUFFICIENT_BALANCE" };

  const [inventoryItem] = await db
    .select()
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
    .limit(1);
  if (!inventoryItem) return { ok: false, reason: "OUT_OF_STOCK" };

  // ── Atomic transaction: inventory claim + balance deduction + coupon + order ──
  const newBalance = +(currentBalance - finalPrice).toFixed(2);
  const now = new Date();
  const order = await db
    .transaction(async (tx) => {
      // Atomic inventory claim inside transaction to prevent race conditions
      const [inv] = await tx
        .update(inventoryTable)
        .set({ isSold: true, soldAt: now })
        .where(and(eq(inventoryTable.id, inventoryItem.id), eq(inventoryTable.isSold, false)))
        .returning();
      if (!inv) throw new Error("INVENTORY_CLAIMED");

      const newLifetimeSpend = +(parseFloat(String(user.lifetimeSpend)) + finalPrice).toFixed(2);
      const [updatedUser] = await tx
        .update(usersTable)
        .set({
          walletBalance: String(newBalance),
          lifetimeSpend: String(newLifetimeSpend),
          loyaltyPoints: user.loyaltyPoints + Math.floor(finalPrice),
          loyaltyTier: computeTier(newLifetimeSpend),
        })
        .where(and(eq(usersTable.id, userId), eq(usersTable.walletBalance, String(currentBalance))))
        .returning();
      if (!updatedUser) throw new Error("CONCURRENCY_ERROR");

      if (appliedCoupon) {
        const newUsedCount = appliedCoupon.usedCount + 1;
        await tx
          .update(couponsTable)
          .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
          .where(eq(couponsTable.id, appliedCoupon.id));
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
          deliveredPassword: safeDecrypt(inventoryItem.accountPassword),
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
        return null;
      }
      throw err;
    });

  if (!order) return { ok: false, reason: "INVENTORY_CLAIMED" };

  return { ok: true, order, product, user, finalPrice };
}

export const CheckoutService = { purchase };
