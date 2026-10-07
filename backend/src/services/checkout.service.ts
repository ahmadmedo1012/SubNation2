import {
  couponsTable,
  db,
  flashSalesTable,
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
  providerFulfillmentsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { computePricing, isAppliedCoupon, isInvalidCoupon } from "../lib/pricing";
import { generateOrderCode } from "../lib/crypto";
// R102: isEncrypted/safeDecrypt moved WITH the claim block into
// services/providers/manual.provider.ts (the deliverability gate's home).
import {
  claimIdempotencyKey,
  findIdempotentOrderId,
  isIdempotencyKeyViolation,
  scopeIdempotencyKey,
} from "../lib/idempotency";
import { insertLedgerEntry } from "../lib/ledger";
import { logAdminAlert } from "../jobs/alertLogger";
import { notifyCouponMaxedOut } from "../telegram";
import { computeTier, purchaseAwardPoints } from "../lib/loyalty-policy";
import { insertPointsLedgerEntry } from "../lib/points-ledger";
import { toNumber } from "../lib/numeric";
import { getFulfillmentProvider } from "./providers/registry";

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
  | "INVALID_PRICE"
  // B2-06 (round-92 audit): the flash sale that priced this purchase
  // expired / was deactivated / had its discount changed between
  // computePricing (pre-tx) and the purchase transaction. Retryable —
  // the client re-prices and retries at the current price.
  | "STALE_FLASH_SALE"
  // R93-DATA (round-93 post-deploy live audit): the claimed inventory
  // unit's credentials are UNDELIVERABLE — the stored ciphertext cannot
  // be decrypted with the current ENCRYPTION_KEY (wrong/rotated key at
  // load time) or the unit has no deliverable fields at all. Charging a
  // buyer for credentials that will render as null is a money-for-nothing
  // sale, so the transaction fails closed BEFORE any mutation commits:
  // the claim rolls back, the wallet is never debited, and a deduped
  // admin alert names the product + unit so the operator can re-upload
  // stock. (Live evidence: 59/59 units of products 1-12 are
  // undecryptable — seeded 2026-08-25 with a different key.)
  | "INVENTORY_CORRUPT"
  // Catalog-2026-09-20: the request named a variant that does not exist,
  // is inactive, or belongs to a different product. Distinct from
  // PRODUCT_NOT_FOUND so clients can re-read the product's variant list.
  | "VARIANT_NOT_FOUND";

// F4 (round-94 A4): product-stale (price / isActive / isArchived changed
// between computePricing and the purchase tx) is deliberately NOT a new
// CheckoutFailureReason member: the route's reason switch is exhaustive
// and route mapping is another agent's ownership this round. It reuses
// the retryable CONCURRENCY_ERROR channel — semantically honest (a
// concurrent mutation invalidated the read set; the client re-reads and
// retries) — with a stable machine-readable `code: "PRODUCT_STALE"`
// riding the failure envelope for tests and future route wiring.

export type CheckoutResult =
  | {
      ok: true;
      order: typeof ordersTable.$inferSelect;
      product: typeof productsTable.$inferSelect;
      user: typeof usersTable.$inferSelect;
      finalPrice: number;
      // F10 (round-94 A4): true when this call REPLAYED the order a
      // previous call with the same Idempotency-Key already created —
      // nothing was charged, debited, or claimed in THIS call. Routes
      // use it to set `Idempotent-Replayed: true`, return 200 (not
      // 201), and skip the new-order notifications.
      idempotentReplay?: boolean;
    }
  | {
      ok: false;
      reason: CheckoutFailureReason;
      message?: string;
      // F4 (round-94 A4): stable machine-readable cause riding alongside
      // the retryable CONCURRENCY_ERROR reason (e.g. "PRODUCT_STALE").
      code?: string;
    };

export interface CheckoutInput {
  userId: number;
  productId: number;
  /**
   * Catalog variant (product_variants.id) the buyer selected. Optional:
   * legacy callers omit it. When the product HAS active variants the
   * checkout resolves one — the exact requested variant, or the cheapest
   * active one as the default — so a variant-aware price is always
   * charged. Variant-less products price off products.price as before.
   */
  variantId?: number | null;
  couponCode?: string;
  /**
   * F10 (round-94 A4): optional durable idempotency key — the raw
   * `Idempotency-Key` header value, passed through by the route. The
   * service scopes it per-user, replays the original order on a retry,
   * and claims it atomically inside the purchase transaction. Absent /
   * undersized / oversized keys run the legacy unguarded path (parity
   * with the HTTP middleware's minimum-length rule).
   */
  idempotencyKey?: string;
}

export async function purchase(input: CheckoutInput): Promise<CheckoutResult> {
  const { userId, productId } = input;
  const couponCode = input.couponCode;

  // ── F10: durable idempotency — pre-tx replay lookup ──────────────────
  // Runs FIRST, before pricing / balance checks: a retry of a purchase
  // that already committed must return the original order even though
  // the wallet was already debited (otherwise the retry would surface
  // INSUFFICIENT_BALANCE for a purchase the buyer actually owns — the
  // most damaging flavor of a broken idempotency contract).
  //
  // Legacy-safe: while the idempotency_keys table is missing (SQLSTATE
  // 42P01 → latched no-op, see lib/idempotency.ts) the lookup misses and
  // behavior is byte-identical to pre-F10.
  const scopedIdempotencyKey = scopeIdempotencyKey(userId, input.idempotencyKey);
  if (scopedIdempotencyKey) {
    // R108 (FH-A7 P3-1): filter by intent — a client reusing one
    // Idempotency-Key across /orders and /topups must never resolve the
    // OTHER intent's row here (the topup side has filtered since R104).
    // Safe for legacy rows: V1-M19 backfilled every pre-existing claim
    // to reference_type='order'.
    const replayedOrderId = await findIdempotentOrderId(scopedIdempotencyKey, "order");
    if (replayedOrderId !== null) {
      const replay = await replayOriginalOrder(userId, replayedOrderId);
      if (replay) return replay;
      // The key points at an order this user no longer owns (or a
      // cascade-deleted one). Fall through to a fresh purchase; the
      // in-tx claim below surfaces a still-live stale key as a
      // classified conflict instead of a second charge.
    }
  }

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

  // ── Variant resolution (catalog 2026-09-20) ─────────────────────────────
  // The buyer's selected option rides the request as variantId. Legacy
  // callers that omit it still get a variant-aware price when the product
  // has variants: the cheapest ACTIVE one (identical to the storefront's
  // "تبدأ من" display price, so no mismatch is chargeable). The resolved
  // row is the pricing authority — products.price is NOT consulted when
  // a variant is resolved (the import maintains products.price =
  // MIN(variants.price_lyd) as a display denormalization only).
  let variant: typeof productVariantsTable.$inferSelect | null = null;
  const productVariants = await db
    .select()
    .from(productVariantsTable)
    .where(
      and(eq(productVariantsTable.productId, productId), eq(productVariantsTable.isActive, true)),
    )
    .orderBy(productVariantsTable.priceLyd)
    .limit(500);
  if (input.variantId != null) {
    // EXPLICIT selection: must resolve to THIS product's active variant —
    // a foreign, inactive, or deleted id fails closed (never silently
    // ignored: the client would be charged a price it never displayed).
    variant = productVariants.find((v) => v.id === input.variantId) ?? null;
    if (!variant) return { ok: false, reason: "VARIANT_NOT_FOUND" };
  } else if (productVariants.length > 0) {
    // Legacy callers that omit variantId still get a variant-aware price:
    // the cheapest ACTIVE one (identical to the storefront's "تبدأ من"
    // display price, so no mismatch is chargeable).
    variant = productVariants[0];
  }

  /** Customer-facing purchase label, copied immutably onto the order. */
  const variantLabel = variant
    ? [variant.planLabel?.trim(), variant.durationLabel?.trim()].filter(Boolean).join(" — ") || null
    : null;

  // ── Discount stack (flash sale → coupon → final) — single source: lib/pricing.ts
  const pricing = await computePricing({
    listPrice: variant ? toNumber(variant.priceLyd) : toNumber(product.price),
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
  if (
    !Number.isFinite(finalPrice) ||
    finalPrice <= 0 ||
    !Number.isFinite(discountAmount) ||
    discountAmount < 0
  ) {
    return { ok: false, reason: "INVALID_PRICE" };
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return { ok: false, reason: "USER_NOT_FOUND" };

  const currentBalance = toNumber(user.walletBalance);
  if (currentBalance < finalPrice) return { ok: false, reason: "INSUFFICIENT_BALANCE" };

  // Cheap lock-free OUT_OF_STOCK fast-fail — the authoritative,
  // race-free selection happens INSIDE the transaction with
  // FOR UPDATE SKIP LOCKED (H4). Variant-scoped units are preferred;
  // legacy product-level units (variant_id IS NULL) fulfill any variant.
  const inventoryScope = variant
    ? and(
        eq(inventoryTable.productId, productId),
        eq(inventoryTable.isSold, false),
        or(eq(inventoryTable.variantId, variant.id), isNull(inventoryTable.variantId)),
      )
    : and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false));
  const [inventoryFastCheck] = await db
    .select({ id: inventoryTable.id })
    .from(inventoryTable)
    .where(inventoryScope)
    .limit(1);
  if (!inventoryFastCheck) return { ok: false, reason: "OUT_OF_STOCK" };

  // ── Atomic transaction: inventory claim + balance deduction + coupon + order ──
  const newBalance = +(currentBalance - finalPrice).toFixed(2);

  // F8 (round-94 A4): coupon-maxed side effects are DEFERRED until after
  // the transaction commits (refund.service.ts:271 establishes the
  // principle: "Emitted AFTER the tx commits (a pre-commit emission would
  // survive a rollback as a false positive …)"). The old in-tx emission
  // meant a later statement failing in the tx (ledger insert, orderCode
  // collision) rolled usedCount back — yet the operator had already
  // received the Telegram card + admin-alert row, AND the 24h dedupe key
  // in logAdminAlert then SUPPRESSED the true emission when a real buyer
  // exhausted the coupon later. A signal object written inside the tx and
  // read AFTER the commit (below) cannot produce a false alert on
  // rollback. (Object holder rather than a `let` — TS control-flow keeps
  // a let initialized-to-null narrowed across closure writes.)
  const couponMaxedSignal: { code: string | null; maxUses: number } = {
    code: null,
    maxUses: 0,
  };

  const order = await db
    .transaction(async (tx) => {
      // B2-05/B2-06 (round-92 audit): expiry clock, captured INSIDE the
      // transaction. Capturing it pre-tx (before BEGIN) would leave the
      // audit's named window — pricing at T0, commit at T0+Δ — partially
      // open: a sale/coupon ending at T0+ε (ε < Δ) would still pass an
      // `endsAt > T0` predicate evaluated at T0+Δ. Captured here, the
      // predicate is evaluated against a timestamp taken after the
      // transaction opened, so the only residual window is the few
      // in-transaction statements between this line and the guarded
      // UPDATE — the tightest bound available on the app clock (the same
      // clock lib/pricing.ts validates with, so app/DB skew cannot
      // produce false STALE/EXHAUSTED rejections).
      const now = new Date();

      // F4 (round-94 A4): product freshness re-check INSIDE the purchase
      // transaction — the first link of the pricing chain finally gets the
      // same guard its siblings already had (flash sale B2-06, coupon
      // B2-05/B2-06). `product` (price/isActive/isArchived) was read BEFORE
      // computePricing opened this tx; an admin raising the price (or
      // deactivating/archiving the product) in that window previously let
      // the buyer be debited the STALE price, or buy a just-archived
      // product (out-of-catalog sale). Re-read the row here — a plain
      // SELECT inside the tx evaluates against the latest committed
      // snapshot under READ COMMITTED, exactly like the flash-sale guard
      // above; a FOR UPDATE row lock was deliberately NOT taken (it would
      // serialize ALL concurrent buyers of one product on a row the
      // inventory claim's SKIP LOCKED specifically avoids contending).
      // Comparison is value-based (numeric string → float), matching the
      // wallet CAS predicate convention ("10.50" = '10.5').
      {
        const [productRow] = await tx
          .select({
            price: productsTable.price,
            isActive: productsTable.isActive,
            isArchived: productsTable.isArchived,
          })
          .from(productsTable)
          .where(eq(productsTable.id, productId))
          .limit(1);
        const productStale =
          !productRow ||
          !productRow.isActive ||
          productRow.isArchived ||
          parseFloat(String(productRow.price)) !== toNumber(product.price);
        if (productStale) throw new Error("PRODUCT_STALE");
      }

      // Catalog-2026-09-20: variant freshness re-check — the same F4
      // guard the product just got, for the VARIANT the price was built
      // from (variant price / isActive / product membership). An admin
      // editing the variant between computePricing and commit otherwise
      // debits a stale per-option price.
      if (variant) {
        const [variantRow] = await tx
          .select({
            priceLyd: productVariantsTable.priceLyd,
            isActive: productVariantsTable.isActive,
            productId: productVariantsTable.productId,
          })
          .from(productVariantsTable)
          .where(eq(productVariantsTable.id, variant.id))
          .limit(1);
        const variantStale =
          !variantRow ||
          !variantRow.isActive ||
          variantRow.productId !== productId ||
          parseFloat(String(variantRow.priceLyd)) !== toNumber(variant.priceLyd);
        if (variantStale) throw new Error("VARIANT_STALE");
      }

      // B2-06 (round-92 audit): flash-sale freshness re-check INSIDE the
      // purchase transaction. `pricing.flashSale` was resolved by
      // computePricing BEFORE this tx opened — a sale crossing ends_at (or
      // an admin deactivating it / changing the discount) in the window
      // between validation and commit previously let the discounted price
      // survive a few hundred ms past expiry (flashSaleWatcher runs every
      // 5 min but is not the authority). Re-read the priced sale row here;
      // reject as STALE_FLASH_SALE if it is no longer active, has expired,
      // or its discount no longer matches the one the price was built from.
      // (The opposite race — a sale activating mid-flight after pricing at
      // list price — only means the buyer skipped a discount, not a loss.)
      if (pricing.flashSale) {
        const [saleRow] = await tx
          .select({
            id: flashSalesTable.id,
            isActive: flashSalesTable.isActive,
            endsAt: flashSalesTable.endsAt,
            discountPercent: flashSalesTable.discountPercent,
          })
          .from(flashSalesTable)
          .where(eq(flashSalesTable.id, pricing.flashSale.id))
          .limit(1);
        const saleStale =
          !saleRow ||
          !saleRow.isActive ||
          saleRow.endsAt.getTime() <= now.getTime() ||
          parseFloat(String(saleRow.discountPercent)) !== pricing.flashSale.discountPercent;
        if (saleStale) throw new Error("STALE_FLASH_SALE");
      }

      // R102 (provider-readiness): fulfillment is provider-owned. The
      // claim block below (H4's two ordered FOR UPDATE SKIP LOCKED selects
      // → R93-DATA deliverability gate → the guarded claim UPDATE) moved
      // VERBATIM into ManualProvider (services/providers/manual.provider.ts)
      // — today's only registered provider (registry.ts, env
      // FULFILLMENT_PROVIDER, default + fail-safe 'manual'). Business
      // rules are UNCHANGED — the transaction body was moved, not
      // rewritten. A future external provider registers in the registry
      // and slots in here without this file learning provider specifics.
      const provider = getFulfillmentProvider();
      const fulfillment = await provider.fulfill(
        { productId, variantId: variant?.id ?? null, now },
        tx as unknown as typeof db,
      );
      if (!fulfillment.ok) {
        // Map the provider's structured refusal onto the SAME stable
        // error strings the catch below has always keyed on (INVENTORY_*
        // ride the existing CheckoutFailureReason members).
        throw new Error(
          fulfillment.reason === "INVENTORY_CORRUPT"
            ? `INVENTORY_CORRUPT:${fulfillment.detail ?? ""}`
            : fulfillment.reason,
        );
      }
      const claimedUnit = fulfillment.unit;

      const newLifetimeSpend = +(toNumber(user.lifetimeSpend) + finalPrice).toFixed(2);
      // R115: the award formula lives in lib/loyalty-policy (single source)
      // and the mutation is attributed in points_ledger below — same tx.
      const awardPoints = purchaseAwardPoints(finalPrice);
      const pointsBeforeAward = user.loyaltyPoints;
      const pointsAfterAward = user.loyaltyPoints + awardPoints;
      const [updatedUser] = await tx
        .update(usersTable)
        .set({
          walletBalance: String(newBalance),
          lifetimeSpend: String(newLifetimeSpend),
          loyaltyPoints: pointsAfterAward,
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
        // B2-05 (round-92 audit): the same predicate now also re-asserts
        // `is_active = true` and `expires_at > now()` at redemption time.
        // resolveCoupon validates both pre-transaction, but an admin
        // deactivation (or the clock crossing expires_at) landing between
        // validation and commit previously still redeemed a just-dead coupon
        // — the guarded UPDATE is the commit-time authority. 0 rows for ANY
        // of these reasons surfaces as COUPON_EXHAUSTED (409-retryable at
        // the route). This also hardens the maxUses=null branch, which was
        // previously guarded by the id match alone.
        const couponStillValid = and(
          eq(couponsTable.isActive, true),
          or(isNull(couponsTable.expiresAt), gt(couponsTable.expiresAt, now)),
        );
        const couponWhere = and(
          eq(couponsTable.id, appliedCoupon.id),
          couponStillValid,
          ...(appliedCoupon.maxUses === null
            ? []
            : [sql`${couponsTable.usedCount} < ${appliedCoupon.maxUses}`]),
        );
        const [updatedCoupon] = await tx
          .update(couponsTable)
          .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
          .where(couponWhere)
          .returning();
        if (!updatedCoupon) throw new Error("COUPON_EXHAUSTED");
        if (appliedCoupon.maxUses !== null && newUsedCount >= appliedCoupon.maxUses) {
          // F8: signal only — see the declaration above. notifyCouponMaxedOut
          // + logAdminAlert fire AFTER the commit (below), so a rollback
          // can never leave a false "coupon exhausted" alert + a 24h
          // dedupe entry that mutes the real one.
          couponMaxedSignal.code = appliedCoupon.code;
          couponMaxedSignal.maxUses = appliedCoupon.maxUses;
        }
      }

      const [o] = await tx
        .insert(ordersTable)
        .values({
          orderCode: generateOrderCode(),
          userId,
          productId,
          // Catalog-2026-09-20: the purchased option, plus its label as an
          // immutable historical copy (delivered_* contract — order history
          // must never rewrite itself even if the variant is later edited
          // or deleted; FK is ON DELETE SET NULL for that reason).
          variantId: variant?.id ?? null,
          variantLabel,
          inventoryId: claimedUnit.inventoryItemId,
          amount: String(finalPrice),
          walletBalanceBefore: String(currentBalance),
          walletBalanceAfter: String(newBalance),
          status: "completed",
          deliveredEmail: claimedUnit.email,
          // H2 (deep-audit 2026-09-06): store the password ENCRYPTED at
          // rest — the provider returns it in its AT-REST shape (the
          // inventory value is already AES-256-GCM ciphertext for manual
          // fulfillment, so it passes through unchanged). The old code
          // decrypted it here, leaving plaintext credentials in every
          // orders row (a DB dump / backup leak = every delivered account
          // exposed). The API boundary (routes/orders.ts formatOrder)
          // still decrypts with safeDecrypt, and legacy plaintext rows
          // pass through it unchanged — no backfill needed.
          deliveredPassword: claimedUnit.password,
          deliveredExtraDetails: claimedUnit.extraDetails,
          deliveredUsageTerms: product.usageTerms ?? null,
          deliveredAt: now,
          couponCode: appliedCoupon?.code ?? null,
          discountAmount: String(discountAmount),
        })
        .returning();

      // R102 (provider-readiness): durable fulfillment record — WHO
      // fulfilled this order, against WHICH provider order, in the SAME
      // transaction as the order + charge + ledger. Manual: attempt 1,
      // 'succeeded', no provider order id. A future async provider writes
      // 'pending' here and settles post-commit — orders.status stays the
      // only customer-visible gate either way. The PLAIN UNIQUE
      // (provider, provider_order_id) index — NULLS DISTINCT, the default
      // — is the DB-level provider idempotency anchor (V1-M18): the
      // non-null half prevents one provider order from backing two
      // orders, while the NULL half stays permissive so manual rows
      // (provider_order_id NULL) can coexist. AUD103-1-F1 (r103): do NOT
      // "fix" this to NULLS NOT DISTINCT — that exact change collided
      // with a second manual purchase in r102 and was reverted.
      await tx.insert(providerFulfillmentsTable).values({
        orderId: o.id,
        provider: provider.id,
        attempt: 1,
        status: "succeeded",
        providerOrderId: claimedUnit.providerOrderId,
      });

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
          description: variantLabel
            ? `Purchase: ${product.name} — ${variantLabel}`
            : `Purchase: ${product.name}`,
        },
        tx as unknown as typeof db,
      );

      // R115 (Part 8): attribute the purchase award in points_ledger —
      // same tx, referencing THIS order. The partial UNIQUE
      // (type='purchase_award', reference_id=order) makes a double award
      // for one order structurally impossible, and refund.service reads
      // exactly this row to reverse the precise remainder.
      if (awardPoints > 0) {
        await insertPointsLedgerEntry(
          {
            userId,
            type: "purchase_award",
            pointsDelta: awardPoints,
            pointsBefore: pointsBeforeAward,
            pointsAfter: pointsAfterAward,
            referenceId: o.id,
            referenceType: "order",
          },
          tx as unknown as typeof db,
        );
      }

      // F10 (round-94 A4): claim the idempotency key in the SAME
      // transaction — after the order + ledger so the claim, the charge,
      // and the audit trail are one atomic unit. A claim that collides
      // (SQLSTATE 23505 — a same-key request committed concurrently)
      // aborts the WHOLE tx: no second debit, no second order, no ledger
      // drift; the catch below replays the winner's order. Skipped when
      // the request carried no usable key or the table is missing
      // (legacy deploy, pre-V1-M12).
      if (scopedIdempotencyKey) {
        await claimIdempotencyKey(tx as unknown as typeof db, scopedIdempotencyKey, o.id);
      }

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
      if (err.message === "STALE_FLASH_SALE") {
        // B2-06 — the flash sale that priced this purchase ended (or
        // changed) between pricing and the tx. Retryable: the client
        // re-prices at the current (list) price.
        return { failure: "STALE_FLASH_SALE" as const };
      }
      if (err.message === "PRODUCT_STALE") {
        // F4 (round-94 A4) — the product's price / isActive / isArchived
        // changed between computePricing and this tx (admin raise,
        // deactivation, archive). Nothing was mutated. Retryable: the
        // client re-prices at the current price; surfaces as the stable
        // CONCURRENCY_ERROR channel with code=PRODUCT_STALE (see the
        // CheckoutFailureReason comment above for why not a new member).
        return { failure: "PRODUCT_STALE" as const };
      }
      if (err.message === "VARIANT_STALE") {
        // Catalog-2026-09-20 — the variant's price / isActive changed
        // between computePricing and the tx. Same envelope as PRODUCT_STALE
        // (retryable, re-price) with its own stable code so clients can
        // refresh the variant list specifically.
        return { failure: "VARIANT_STALE" as const };
      }
      if (isIdempotencyKeyViolation(err)) {
        // F10 — the key claim collided with a concurrent same-key purchase
        // that committed first. This tx (charge + order + ledger) fully
        // rolled back — money intact. The post-catch handling replays the
        // winner's order.
        return { failure: "IDEMPOTENT_CLAIM_CONFLICT" as const };
      }
      if (err.message.startsWith("INVENTORY_CORRUPT:")) {
        // R93-DATA — the tx already rolled back (claim + debit + coupon
        // all reverted). Fire the operator alert OUTSIDE the transaction
        // so an alerting failure can never block the rollback path. The
        // 24h dedupe key per product keeps the drawer readable while a
        // broken catalog keeps receiving purchase attempts.
        const unitId = err.message.split(":")[1] ?? "?";
        logAdminAlert(
          "inventory_corrupt",
          `مخزون غير قابل للتسليم: ${product.name}`,
          `وحدة المخزون #${unitId} للمنتج «${product.name}» تحتوي بيانات اعتماد لا يمكن فك تشفيرها بالمفتاح الحالي — رُفض البيع ولم يُخصم أي مبلغ. ` +
            `أعد رفع مخزون هذا المنتج من لوحة الأدمن، وإلا سيصل المشتري بريد/كلمة مرور فارغة رغم الدفع.`,
          { dedupeKey: `inventory:corrupt:${productId}` },
        );
        return { failure: "INVENTORY_CORRUPT" as const };
      }
      throw err;
    });

  // R122 (A3-P2-5): the old `if (!order) return { ok: false, reason:
  // "INVENTORY_CLAIMED" }` fallback was DEAD — the transaction callback
  // either returns the inserted order row or throws (which the catch above
  // maps to a {failure} object or rethrows), so `order` is never
  // null/undefined. Worse, it was DISHONEST: if a future refactor ever made
  // it reachable, the retryable "someone else claimed the stock" 409 would
  // mask the real defect. Assertion-style guard instead — a logic
  // regression now fails loudly (500 via the global handler, caught by
  // tests) with an error that names the actual invariant.
  if (!order) {
    throw new Error("checkout: transaction resolved without an order or a failure reason");
  }
  if (typeof order === "object" && "failure" in order) {
    if (order.failure === "PRODUCT_STALE") {
      // F4 — internal marker → stable retryable envelope (see comments at
      // the type definition and the catch branch).
      return {
        ok: false,
        reason: "CONCURRENCY_ERROR",
        code: "PRODUCT_STALE",
        message:
          "تغيّرت بيانات المنتج (السعر/الحالة) أثناء إتمام الشراء. أعد المحاولة بالسعر الحالي.",
      };
    }
    if (order.failure === "VARIANT_STALE") {
      // Catalog-2026-09-20 — same retryable envelope for the variant.
      return {
        ok: false,
        reason: "CONCURRENCY_ERROR",
        code: "VARIANT_STALE",
        message: "تغيّر سعر الباقة المختارة أثناء إتمام الشراء. أعد المحاولة بالسعر الحالي.",
      };
    }
    if (order.failure === "IDEMPOTENT_CLAIM_CONFLICT") {
      // F10 — a same-key purchase committed between our lookup and our
      // claim. Our tx rolled back untouched; re-read the winner's order
      // and return it as an idempotent replay (the standard retry
      // contract). If it can't be reconstructed (deleted mid-flight,
      // lookup raced), degrade to the retryable 409 — never a second
      // charge, never a raw 500.
      if (scopedIdempotencyKey) {
        const winnerOrderId = await findIdempotentOrderId(scopedIdempotencyKey, "order");
        if (winnerOrderId !== null) {
          const replay = await replayOriginalOrder(userId, winnerOrderId);
          if (replay) return replay;
        }
      }
      return { ok: false, reason: "CONCURRENCY_ERROR" };
    }
    return { ok: false, reason: order.failure };
  }

  // F8 — coupon-maxed side effects, strictly AFTER the commit (see the
  // couponMaxedSignal declaration). Fire-and-forget, same as before, just
  // on the honest side of the commit boundary.
  if (couponMaxedSignal.code !== null) {
    notifyCouponMaxedOut(couponMaxedSignal.code, couponMaxedSignal.maxUses);
    logAdminAlert(
      "coupon_maxed",
      `كوبون استُنفد: ${couponMaxedSignal.code}`,
      `وصل الكوبون إلى الحد الأقصى من الاستخدام (${couponMaxedSignal.maxUses} مرة) وأُوقف تلقائياً`,
    );
  }

  return { ok: true, order, product, user, finalPrice };
}

/**
 * F10 — reconstruct the success result for an order a previous same-key
 * purchase created. Read-only: no pricing, no balance check, no claim.
 * The replayed envelope carries idempotentReplay=true so the route can
 * shape the HTTP response (200 + Idempotent-Replayed header, skip the
 * new-order notifications). Returns null when the order no longer
 * belongs to this user (FK cascade deleted it with its account, or the
 * key row is stale) — callers then fall through to a fresh purchase or
 * a retryable conflict, never a fabricated success.
 */
async function replayOriginalOrder(
  userId: number,
  orderId: number,
): Promise<CheckoutResult | null> {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.userId, userId)))
    .limit(1);
  if (!order) return null;

  const [productRow] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, order.productId))
    .limit(1);
  // products.id is referenced by orders with ON DELETE RESTRICT — a live
  // order always has its product row; the guard is for type-safety only.
  if (!productRow) return null;

  const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!userRow) return null;

  return {
    ok: true,
    order,
    product: productRow,
    user: userRow,
    finalPrice: toNumber(order.amount),
    idempotentReplay: true,
  };
}

export const CheckoutService = { purchase };
