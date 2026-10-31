import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWalletLedgerQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
  getListProductsQueryKey,
  useCreateOrder,
  useGetWallet,
  useValidateCoupon,
  type CreateOrderBody,
  type Order,
  type ValidateCouponBody,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Card, Divider } from "@/components/card";
import { Icon } from "@/components/icon";
import { EmptyState, Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { useCart, type LocalCartItem } from "@/lib/cart";
import { ErrorCode, getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { arabicCount, formatCurrency } from "@/lib/money";
import { useColors, radius, spacing, type } from "@/theme";

import { apiErrorData, isCouponFailureMessage, isHttpApiError } from "./checkout-errors";
import {
  clearCheckoutGroupKey,
  loadCheckoutGroupKey,
  persistCheckoutGroupKey,
} from "./checkout-group-key";
import {
  clearCheckoutUnitKey,
  checkoutUnitFingerprint,
  loadCheckoutUnitKey,
  persistCheckoutUnitKey,
} from "./checkout-unit-key";
import { couponQuoteLines, roundToCents, validateCouponForLines } from "./coupon-quote";
import { readLiveCartItems } from "./live-cart";

/**
 * Checkout — the money path (the native port of the web's
 * pages/checkout.tsx).
 *
 * THE LOOP (LAW — FINAL_MONEY_INVARIANTS M4/M5/M6 + the mobile spec's
 * MONEY RULES): `CreateOrderBody` accepts ONE product (quantity 1), so
 * a cart line with quantity N becomes N SEPARATE sequential POSTs, each
 * with:
 *   • its OWN Idempotency-Key — minted lazily on the unit's first
 *     attempt, PERSISTED before the POST leaves the device (the
 *     {k, t, f} envelope, INTENT_SLOTS.checkoutUnit + INTENT_TTL_MS),
 *     reused verbatim on manual retries (a retry replays the server's
 *     cached response instead of re-charging — M5/M6), cleared ONLY at
 *     a definitive resolution (per-unit HTTP rejection — except 409
 *     IDEMPOTENCY_IN_FLIGHT, whose sibling may still be executing — or
 *     the accounted-success cart-sync step);
 *   • the attempt's order-group token (ONE UUID per confirm, reused
 *     across every unit AND across partial-failure retries of the same
 *     basket — the subset-tolerant load in checkout-group-key.ts;
 *     informational clustering only, never money math);
 *   • the selected variant + the coupon code.
 *
 * The device NEVER computes an authoritative total: the local
 * total/coupon math is a display hint; the server quotes and charges.
 * Insufficient balance surfaces the SERVER's INSUFFICIENT_BALANCE
 * verdict via getErrorMessage plus a top-up CTA.
 *
 * Native deltas from the web shell (semantics preserved):
 *   • the balance probe rides useGetWallet (the native balance source —
 *     the web's me.wallet_balance chip has no native twin);
 *   • the 98-F2 live-requote machine (useCheckoutRequote) is not ported:
 *     cart price/stock snapshots are advisory, the server re-checks
 *     price + stock in-tx at charge time, and the CTA's stock gate keys
 *     off the same snapshots the cart screen shows;
 *   • success renders IN-SCREEN (first order code + CTA) instead of an
 *     auto-redirect, per the mobile spec.
 */

/** Server-side per-line cap — the loop's honest denominator (H7). */
const MAX_UNITS_PER_LINE = 99;

/** The pre-validated coupon result (the web's AppliedCoupon). */
interface AppliedCoupon {
  code: string;
  /** Per-unit post-coupon final, keyed by lineKey (productId:variantId). */
  lineUnitFinals: Record<string, number>;
  final_amount: number;
  discount_amount: number;
}

/** Arabic plural forms for created-order counts (post-verb OBJECT form). */
const ORDER_COUNT_FORMS_OBJECT = {
  zero: "طلب",
  one: "طلب",
  two: "طلبين",
  few: "طلبات",
  many: "طلباً",
  other: "طلب",
};

/** The full-success outcome state (rendered as the success screen). */
interface CheckoutSuccess {
  firstOrderCode: string | null;
  createdCount: number;
  /** Every unit was accounted for elsewhere (live-cart skips) — informative. */
  completedElsewhere: boolean;
}

function lineKeyOf(line: Pick<LocalCartItem, "productId" | "variantId">): string {
  return `${line.productId}:${line.variantId ?? 0}`;
}

/** A proven-unchargeable line (stock 0 / qty > snapshot) blocks the charge. */
function lineBlocksCheckout(line: LocalCartItem): boolean {
  const stock = line.stockCount ?? null;
  if (stock === null) return false;
  return stock <= 0 || stock < line.quantity;
}

/** Per-line advisory stock notice (the cart screen's strings). */
function lineStockNotice(line: LocalCartItem): string | null {
  const stock = line.stockCount ?? null;
  if (stock === null) return null;
  if (stock <= 0) return "نفد المخزون";
  if (stock < line.quantity) return `الكمية المتاحة: ${stock}`;
  return null;
}

/** Product art URL — absolute for expo-image (relative → API origin). */
function resolveImageUri(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

/** The checkout-shaped loading frame (cart hydration / guest redirect window). */
function CheckoutSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <Skeleton style={{ height: 96, borderRadius: radius.md }} />
      <Skeleton style={{ height: 88, borderRadius: radius.md }} />
      <Skeleton style={{ height: 200, borderRadius: radius.md }} />
    </View>
  );
}

/**
 * One summary line: thumb, name/variant, per-unit math (the coupon's
 * post-coupon unit final when applied — the number the loop charges),
 * the line total.
 */
function SummaryLine({
  line,
  appliedCoupon,
}: {
  line: LocalCartItem;
  appliedCoupon: AppliedCoupon | null;
}) {
  const colors = useColors();
  const price = line.salePriceLYD ?? line.priceLYD;
  const unitFinal = appliedCoupon ? appliedCoupon.lineUnitFinals[lineKeyOf(line)] : undefined;
  const displayUnit = unitFinal ?? price;
  const displayTotal = unitFinal != null ? unitFinal * line.quantity : price * line.quantity;
  const notice = lineStockNotice(line);
  const uri = resolveImageUri(line.imageUrl);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.sm,
          borderCurve: "continuous",
          backgroundColor: colors.secondary,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
        ) : (
          <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
            {(line.name ?? "?").charAt(0)}
          </ThemedText>
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <ThemedText
          variant="subhead"
          numberOfLines={1}
          style={{ fontFamily: "ReadexPro-SemiBold" }}
        >
          {line.name}
        </ThemedText>
        {line.variantLabel ? (
          <ThemedText variant="micro" numberOfLines={1} style={{ color: colors.onSurface }}>
            {line.variantLabel}
          </ThemedText>
        ) : null}
        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
        >
          {`${line.quantity} × ${formatCurrency(displayUnit)}`}
        </ThemedText>
        {notice ? (
          <ThemedText variant="micro" style={{ color: colors.warning }}>
            {notice}
          </ThemedText>
        ) : null}
      </View>

      <ThemedText
        variant="subhead"
        selectable
        style={{
          color: colors.foreground,
          fontVariant: ["tabular-nums"],
          fontFamily: "ReadexPro-SemiBold",
        }}
      >
        {formatCurrency(displayTotal)}
      </ThemedText>
    </View>
  );
}

/** The full-success screen: first order code + CTA to its detail. */
function SuccessView({ success }: { success: CheckoutSuccess }) {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.xl,
          gap: spacing.lg,
          flexGrow: 1,
          justifyContent: "center",
        }}
      >
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.full,
              backgroundColor: `${colors.success}1A`,
              borderWidth: 1,
              borderColor: `${colors.success}38`,
              alignItems: "center",
              justifyContent: "center",
            }}
            accessibilityRole="image"
            accessibilityLabel="تم إتمام الطلب"
          >
            <Icon sf="checkmark.circle.fill" md="check_circle" size={34} color={colors.success} />
          </View>

          <ThemedText variant="title" style={{ textAlign: "center" }}>
            {success.completedElsewhere ? "اكتمل الشراء من نافذة أخرى" : "تم إتمام الطلب"}
          </ThemedText>
          <ThemedText variant="subhead" style={{ textAlign: "center", color: colors.onSurface }}>
            {success.completedElsewhere
              ? "تم إنشاء طلباتك هناك وستجدها في صفحة طلباتك"
              : `تم إنشاء ${arabicCount(success.createdCount, ORDER_COUNT_FORMS_OBJECT)} بنجاح`}
          </ThemedText>

          {/* R161-G (multi-order honesty): >1 created order — no single
              receipt tells the story, so the CTA lands on the orders list
              (this screen shows the FIRST code as a reference, never as
              "the" receipt). */}
          {success.firstOrderCode ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                backgroundColor: colors.surfaceCard,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                borderCurve: "continuous",
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                direction: "ltr",
              }}
            >
              <Icon sf="doc.text.fill" md="receipt_long" size={16} color={colors.onSurface} />
              <ThemedText variant="callout" selectable style={{ fontVariant: ["tabular-nums"] }}>
                {success.firstOrderCode}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View style={{ gap: spacing.sm }}>
          {success.firstOrderCode != null && success.createdCount === 1 ? (
            <Button
              title="عرض الطلب"
              size="lg"
              accessibilityHint="الانتقال إلى تفاصيل الطلب"
              onPress={() =>
                router.push(`/(tabs)/(orders)/${encodeURIComponent(success.firstOrderCode ?? "")}`)
              }
            />
          ) : (
            <Button
              title="عرض طلباتي"
              size="lg"
              accessibilityHint="الانتقال إلى قائمة الطلبات"
              onPress={() => router.navigate("/(tabs)/(orders)")}
            />
          )}
          <Button
            title="متابعة التسوق"
            variant="secondary"
            onPress={() => router.navigate("/(tabs)/(home)")}
          />
        </View>
      </ScrollView>
    </View>
  );
}

export function CheckoutScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { items, totalLYD, isLoaded, clear, removeItem, updateQuantity } = useCart();

  const authed = status === "authenticated";

  // ── Coupon state (R94-A1 #9 + 98-F2 — the per-line pre-validated result) ──
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);
  // ── Confirm-flight state ────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [partialCount, setPartialCount] = useState(0);
  const [walletStateUnknown, setWalletStateUnknown] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [success, setSuccess] = useState<CheckoutSuccess | null>(null);

  // Guests are redirected to the login modal with the checkout return
  // path (the cart screen's idiom); the skeleton holds the frame.
  useEffect(() => {
    if (status === "guest") {
      router.replace({ pathname: "/login", params: { redirect: "/checkout" } });
    }
  }, [status, router]);

  // ── Wallet balance (the native balance source; authed only) ─────────────
  const {
    data: wallet,
    isLoading: balanceLoading,
    isError: balanceError,
    refetch: refetchWallet,
  } = useGetWallet({ query: { enabled: authed } });
  // Never fake balance=0 — an absent/failed probe renders the «—» marker
  // and the honest warning, never an insufficient verdict (93-C5 / F-15).
  const balance =
    typeof wallet?.balance === "number" && Number.isFinite(wallet.balance) ? wallet.balance : null;

  // ── Coupon validation (useValidateCoupon on submit) ─────────────────────
  const validateCouponMutation = useValidateCoupon();

  // Cart lines are part of the validation input (98-F2: per-line UNIT
  // prices) — any line change voids the stored result so the post-coupon
  // label can never go stale; the generation counter also discards an
  // in-flight validate whose lines were swapped mid-request (R98-01).
  const couponGenerationRef = useRef(0);
  useEffect(() => {
    couponGenerationRef.current += 1;
    setAppliedCoupon(null);
    setCouponNotice(null);
  }, [items]);

  const applyCoupon = useCallback(async () => {
    const code = coupon.trim().toUpperCase();
    if (!code || totalLYD <= 0) return;
    setCouponChecking(true);
    setCouponNotice(null);
    const lines = couponQuoteLines(items);
    const generation = ++couponGenerationRef.current;
    try {
      const result = await validateCouponForLines(code, lines, (body: ValidateCouponBody) =>
        validateCouponMutation.mutateAsync({ data: body }),
      );
      if (generation !== couponGenerationRef.current) return;
      if (result.status === "network") {
        setAppliedCoupon(null);
        setCouponNotice("تعذّر التحقق من الكوبون — تحقّق من شبكتك ثم أعد المحاولة");
        return;
      }
      if (result.status === "invalid") {
        setAppliedCoupon(null);
        // 98-F2 (F1): the precise per-line reason; in a mixed basket,
        // name the failing line.
        setCouponNotice(
          lines.length > 1 ? `${result.lineName} — ${result.message}` : result.message,
        );
        return;
      }
      setAppliedCoupon({
        code,
        lineUnitFinals: result.lineUnitFinals,
        final_amount: result.finalAmount,
        discount_amount: result.discountAmount,
      });
    } catch {
      // Network-level failure — inconclusive; nothing is applied.
      if (generation === couponGenerationRef.current) {
        setCouponNotice("تعذّر التحقق من الكوبون — تحقّق من شبكتك ثم أعد المحاولة");
      }
    } finally {
      setCouponChecking(false);
    }
  }, [coupon, totalLYD, items, validateCouponMutation]);

  const clearAppliedCoupon = useCallback(() => {
    // Supersede any in-flight validate for the removed code.
    couponGenerationRef.current += 1;
    setAppliedCoupon(null);
    setCouponNotice(null);
  }, []);

  // ── The balance gate (R94-A1 #1: cent-rounded comparison) ────────────────
  const comparisonTotal = roundToCents(appliedCoupon ? appliedCoupon.final_amount : totalLYD);
  const insufficient =
    !balanceLoading && !balanceError && balance !== null && balance < comparisonTotal;
  const isEmpty = items.length === 0;
  const stockBlocked = useMemo(() => items.some(lineBlocksCheckout), [items]);
  const canSubmit = authed && !isEmpty && !submitting && !insufficient && !stockBlocked;

  // ── The per-unit order mutation ─────────────────────────────────────────
  // G-2 (the web wallet's discipline): orval's mutationFn closes over the
  // `request` object at RENDER time, so per-CALL Idempotency-Keys ride a
  // STABLE ref whose headers are read at fetch time and synced
  // immediately before every unit's mutateAsync below.
  const orderRequestRef = useRef<{ headers: Record<string, string> }>({ headers: {} });
  const orderMutation = useCreateOrder({ request: orderRequestRef.current });

  const invalidateMoneyCaches = useCallback(() => {
    // Every charged unit moved the wallet + consumed real stock — refresh
    // the wallet, the ledger, the orders list and the catalog surfaces
    // (the ["/api/products"] prefix also covers by-slug detail caches).
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetWalletLedgerQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
  }, [queryClient]);

  const handleConfirm = useCallback(async () => {
    // AUD103-2-F8: synchronous re-entry guard — the CTA's disabled
    // re-render can lose a race to a second press in one frame; the
    // per-unit keys dedupe server-side, but that stays
    // defense-in-depth, not the guard itself.
    if (!authed || items.length === 0 || submitting) return;
    setSubmitting(true);
    setOrderError(null);
    setPartialCount(0);
    setWalletStateUnknown(false);
    // R115-I1: the honest denominator for «جارٍ المعالجة… N/M» — the SAME
    // clamp the loop below charges.
    setSubmitProgress({
      current: 0,
      total: items.reduce((sum, it) => sum + Math.min(it.quantity, MAX_UNITS_PER_LINE), 0),
    });

    // R165 (the R162 ADR): ONE group token per confirm attempt — reused
    // across every unit-order of the attempt AND across partial-failure
    // retries of the same basket (the subset-tolerant load), cleared ONLY
    // at the live cart's full resolution.
    const groupToken = (await loadCheckoutGroupKey(items)) ?? generateIdempotencyKey();
    await persistCheckoutGroupKey(items, groupToken);

    const created: Order[] = [];
    let firstOrderCode: string | null = null;
    let failureMessage: string | null = null;
    let couponFailure = false;
    // L5-3: a definitive INSUFFICIENT_BALANCE rejection proves the cached
    // balance is stale-high — reseed so the gate + chip recompute.
    let insufficientBalanceRejection = false;
    // AUD103-2-F2: units skipped because the LIVE cart no longer contains
    // them (another surface completed/removed the line mid-flight).
    let skippedElsewhere = 0;
    // P0-3: per-line bookkeeping of units that ACTUALLY got ordered — the
    // cart must mirror exactly what was charged (full lines removed,
    // partial lines shrunk to the remainder).
    const orderedUnitsByLine = new Map<
      string,
      { productId: number; variantId: number | null; units: number }
    >();
    const couponCode = coupon.trim().toUpperCase();

    try {
      // 93-C5 / F-15 + 98-F2: pre-flight the coupon BEFORE the loop
      // charges anything — a deterministic coupon failure mid-loop would
      // land after some units had already been charged. The pre-flight is
      // PER LINE (each line's UNIT price — the exact input the backend's
      // per-unit pricing runs against). A network failure is inconclusive
      // → fail-open: the server re-validates on every unit order anyway.
      if (couponCode && appliedCoupon?.code !== couponCode) {
        const result = await validateCouponForLines(couponCode, couponQuoteLines(items), (body) =>
          validateCouponMutation.mutateAsync({ data: body }),
        );
        if (result.status === "invalid") {
          const message =
            items.length > 1 ? `${result.lineName} — ${result.message}` : result.message;
          setOrderError(
            `الكوبون: ${message} — أزل الكوبون أو صحّحه ثم أعد المحاولة. لم يتم خصم أي مبلغ.`,
          );
          return;
        }
        if (result.status === "valid") {
          // Adopt the honest per-line math for the label + balance gate
          // (the loop below still charges server-side numbers).
          setAppliedCoupon({
            code: couponCode,
            lineUnitFinals: result.lineUnitFinals,
            final_amount: result.finalAmount,
            discount_amount: result.discountAmount,
          });
        }
        // "network" — inconclusive, fail-open.
      }

      for (const it of items) {
        const unitsWanted = Math.min(it.quantity, MAX_UNITS_PER_LINE);
        let unitsOrdered = 0;
        // 98-F2 (r97 F-07): the line-level intent fingerprint for this
        // unit's key — product / variant / coupon / effective unit price.
        const lineFingerprint = checkoutUnitFingerprint(it, couponCode);
        for (let unit = 0; unit < unitsWanted; unit++) {
          // AUD103-2-F2: `items` is a snapshot from when the loop started;
          // re-read the LIVE cart before every unit — if the line is gone
          // or its remaining quantity no longer covers this unit, the unit
          // was accounted for elsewhere: skip it. A null read (storage
          // unavailable) skips the guard entirely.
          const liveCart = await readLiveCartItems();
          if (liveCart) {
            const liveLine = liveCart.find(
              (l) =>
                l.productId === it.productId && (l.variantId ?? null) === (it.variantId ?? null),
            );
            if (!liveLine || liveLine.quantity <= unit) {
              skippedElsewhere++;
              break;
            }
          }

          const body: CreateOrderBody = { product_id: it.productId };
          // R165: the attempt's group token rides EVERY unit body — one
          // logical checkout stays ONE group server-side.
          body.order_group_id = groupToken;
          // Catalog-2026-09-20: the line's SELECTED variant rides every
          // unit order — the checkout charges exactly the option the
          // shopper chose.
          if (it.variantId != null) body.variant_id = it.variantId;
          if (couponCode) body.coupon_code = couponCode;

          // R115-I1: reflect the unit about to be charged in the label.
          setSubmitProgress((p) => (p ? { ...p, current: p.current + 1 } : p));

          // 96-F4: one STABLE Idempotency-Key per unit order — minted
          // lazily on the unit's first attempt, persisted BEFORE the POST,
          // and reused verbatim when this exact unit is retried.
          const unitKey =
            (await loadCheckoutUnitKey(
              it.productId,
              it.variantId ?? null,
              unit,
              lineFingerprint,
            )) ?? generateIdempotencyKey();
          await persistCheckoutUnitKey(
            it.productId,
            it.variantId ?? null,
            unit,
            lineFingerprint,
            unitKey,
          );
          // G-2 belt-and-suspenders: the stable request object's header is
          // read at fetch time — sync it right before the unit POST.
          orderRequestRef.current.headers["Idempotency-Key"] = unitKey;

          try {
            const order = await orderMutation.mutateAsync({ data: body });
            created.push(order);
            unitsOrdered++;
            // 2xx — the unit is resolved, but the key is NOT deleted here:
            // if a LATER unit network-fails, the cart-sync below is
            // skipped and a retry must replay this unit (not re-charge
            // it). The sync step deletes it once accounted in cart.
            if (!firstOrderCode) firstOrderCode = order.order_code;
          } catch (e) {
            if (!isHttpApiError(e)) {
              // Network-level failure: this unit's server state is UNKNOWN
              // (it may have been charged). Rethrow to the outer catch —
              // it shows the error WITHOUT the cart-sync step, so a manual
              // retry can't double-buy units that actually succeeded. The
              // stored key deliberately SURVIVES so that retry reuses it.
              throw e;
            }
            // HTTP-level failure: the backend error envelope arrives as
            // ApiError.data = {error, code} — NEVER `.message` (P0-2);
            // prefer the envelope's specific Arabic sentence over the
            // code map (coupon failures map to INVALID_DATA → «بيانات
            // غير صالحة», which reads like a money error).
            // 99-M1: a 409 IDEMPOTENCY_IN_FLIGHT is NOT a definitive
            // rejection — a sibling with this SAME key may still be
            // executing server-side; clearing the stored key here would
            // mint a fresh one on retry and DOUBLE-CHARGE the unit once
            // the sibling commits. The key survives; the retry replays it.
            if (apiErrorData(e)?.code !== ErrorCode.IDEMPOTENCY_IN_FLIGHT) {
              // The rejection is definitive — clear this unit's stored key
              // so a retry isn't answered forever by the cached error.
              await clearCheckoutUnitKey(it.productId, it.variantId ?? null, unit);
            }
            if (apiErrorData(e)?.code === ErrorCode.INSUFFICIENT_BALANCE) {
              insufficientBalanceRejection = true;
            }
            failureMessage =
              apiErrorData(e)?.error || getErrorMessage(e) || "تعذّر إنشاء الطلب — حاول مرة أخرى";
            couponFailure = isCouponFailureMessage(failureMessage ?? undefined);
            break;
          }
        }
        if (unitsOrdered > 0) {
          orderedUnitsByLine.set(`${it.productId}:${it.variantId ?? 0}`, {
            productId: it.productId,
            variantId: it.variantId ?? null,
            units: unitsOrdered,
          });
        }
        if (failureMessage) break;
      }

      // 93-C5 / F-15: coupon-family failures get explicit recovery
      // guidance — a dead single-use code left in the input would re-fail
      // the same units forever on a plain retry.
      if (couponFailure && failureMessage) {
        if (created.length > 0) {
          setCoupon("");
          setAppliedCoupon(null);
          failureMessage = `${failureMessage} — أُزيل الكوبون من الحقل؛ أعد المحاولة لإكمال الوحدات المتبقية بالسعر الكامل.`;
        } else {
          failureMessage = `${failureMessage} — أزل الكوبون من الحقل ثم أعد المحاولة.`;
        }
      }

      // Sync the cart to exactly what was charged — remove full lines,
      // shrink partial lines to the un-bought remainder — keyed per LINE
      // (productId + variantId), reading the LIVE line at sync time (a
      // mid-flight quantity raise from elsewhere survives as the
      // remainder). The charged units are now ACCOUNTED: their retry keys
      // are resolved and cleared HERE — the only success-side deletion
      // point (the network-failure path above skips the sync precisely so
      // a retry replays those units instead of re-charging).
      for (const { productId, variantId, units } of orderedUnitsByLine.values()) {
        const liveCart = await readLiveCartItems();
        const liveLine = liveCart?.find(
          (l) => l.productId === productId && (l.variantId ?? null) === variantId,
        );
        const line =
          liveLine ??
          items.find((i) => i.productId === productId && (i.variantId ?? null) === variantId);
        if (!line) continue;
        if (units >= line.quantity) removeItem(productId, variantId);
        else updateQuantity(productId, line.quantity - units, variantId);
        for (let unit = 0; unit < units; unit++) {
          await clearCheckoutUnitKey(productId, variantId, unit);
        }
      }

      if (created.length > 0) {
        invalidateMoneyCaches();
      }

      if (failureMessage && created.length === 0) {
        // Complete failure — persistent in-page banner (never a toast).
        if (insufficientBalanceRejection) {
          // The server's verdict proves the cached balance is stale-high —
          // reseed the wallet cache so the chip + the gate recompute.
          void refetchWallet();
        }
        // R161-G: skips mean another surface charged/removed units during
        // this flight — the wallet state is unknown, so the banner must
        // not claim «لم يتم خصم أي مبلغ».
        setWalletStateUnknown(skippedElsewhere > 0);
        setOrderError(failureMessage);
      } else if (failureMessage && created.length > 0) {
        // Partial success: some orders were charged, then one failed.
        // Tell the user EXACTLY what happened — never silently retry; the
        // remaining units stay in the cart and a retry replays the SAME
        // per-unit keys (server replays ownership per M6).
        setPartialCount(created.length);
        setOrderError(failureMessage);
      } else if (created.length === 0 && skippedElsewhere > 0) {
        // Every unit was accounted for elsewhere — informative outcome.
        setSuccess({ firstOrderCode: null, createdCount: 0, completedElsewhere: true });
      } else {
        // Full success.
        // G-5 / L5-4: clear() only when the sync actually emptied the LIVE
        // cart — a mid-flight quantity raise from elsewhere is a NEW
        // purchase intent this confirm never saw.
        const liveAfterSync = await readLiveCartItems();
        if (liveAfterSync === null || liveAfterSync.length === 0) {
          clear();
          // R165: the attempt fully resolved — the group token's lifecycle
          // ends with the basket that minted it (partial failures keep it
          // so the retry's remaining units stay in the SAME group).
          await clearCheckoutGroupKey();
        }
        setSuccess({ firstOrderCode, createdCount: created.length, completedElsewhere: false });
      }
    } catch (e) {
      // Network-level abort (rethrown from the unit loop). If any unit was
      // already charged, the wallet moved too — refresh the caches even
      // though the cart-sync was (deliberately) skipped.
      if (created.length > 0) {
        invalidateMoneyCaches();
      }
      // R160 (audit F1): a network abort AFTER ≥1 confirmed unit is a
      // PARTIAL outcome, never "nothing was deducted".
      if (created.length > 0) setPartialCount(created.length);
      setOrderError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  }, [
    authed,
    items,
    submitting,
    coupon,
    appliedCoupon,
    orderMutation,
    validateCouponMutation,
    clear,
    removeItem,
    updateQuantity,
    invalidateMoneyCaches,
    refetchWallet,
  ]);

  // ── The four states ──────────────────────────────────────────────────────
  if (!authed || !isLoaded) {
    // Guest (redirect in flight) or the cart-hydration window — the
    // checkout-shaped skeleton, never a false «سلتك فارغة» flash.
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <CheckoutSkeleton />
      </View>
    );
  }

  if (success) {
    return <SuccessView success={success} />;
  }

  if (isEmpty) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          title="سلتك فارغة"
          message="أضف منتجات إلى السلة أولاً لإتمام الطلب"
          actionTitle="تصفح المنتجات"
          onAction={() => router.navigate("/(tabs)/(home)")}
          symbol="cart"
        />
      </View>
    );
  }

  const inputStyle = {
    backgroundColor: colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    color: colors.foreground,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    minHeight: spacing.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    direction: "ltr" as const,
  };

  const confirmLabel = submitting
    ? submitProgress && submitProgress.total > 1
      ? `جارٍ المعالجة… ${submitProgress.current}/${submitProgress.total} (${formatCurrency(comparisonTotal)})`
      : `جارٍ المعالجة… (${formatCurrency(comparisonTotal)})`
    : stockBlocked
      ? "بعض العناصر نفد مخزونها — راجع السلة"
      : insufficient
        ? "رصيد المحفظة غير كافٍ — اشحن المحفظة"
        : appliedCoupon
          ? `تأكيد الشراء — الإجمالي بعد الكوبون (${formatCurrency(comparisonTotal)})`
          : `تأكيد الشراء (${formatCurrency(totalLYD)})`;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* ── Payment method — wallet only (the web's honest UX: the backend
             always charges the wallet; a fake COD option is removed). ── */}
      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: spacing.md,
          }}
        >
          <Icon sf="lock.fill" md="lock" size={16} color={colors.onSurface} />
          <ThemedText variant="headline">طريقة الدفع</ThemedText>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            padding: spacing.md,
            borderRadius: radius.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: `${colors.primary}55`,
            backgroundColor: `${colors.primary}14`,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.sm,
              borderCurve: "continuous",
              backgroundColor: `${colors.primary}1A`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon sf="wallet.fill" md="account-balance-wallet" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
                خصم من المحفظة
              </ThemedText>
              <Icon sf="checkmark.circle.fill" md="check_circle" size={14} color={colors.primary} />
            </View>
            <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
              رصيدك{" "}
              <ThemedText
                variant="footnote"
                selectable
                style={{
                  color: colors.foreground,
                  fontVariant: ["tabular-nums"],
                  fontFamily: "ReadexPro-SemiBold",
                }}
              >
                {balanceLoading ? "…" : balance === null ? "—" : formatCurrency(balance)}
              </ThemedText>
            </ThemedText>
          </View>
          {submitting ? <ActivityIndicator color={colors.primary} /> : null}
        </View>

        <ThemedText variant="micro" style={{ color: colors.onSurface, marginTop: spacing.sm }}>
          سيُخصم ثمن طلباتك من رصيد المحفظة فوراً، وتُسلَّم بيانات الحسابات مباشرة بعد الدفع.
        </ThemedText>

        {balanceError ? (
          <View
            accessibilityRole="alert"
            style={{
              marginTop: spacing.sm,
              padding: spacing.md,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: `${colors.warning}1A`,
              borderWidth: 1,
              borderColor: `${colors.warning}38`,
            }}
          >
            <ThemedText variant="footnote" style={{ color: colors.warning }}>
              تعذّر التحقق من رصيدك. يمكن المتابعة وسيتم التحقق من الرصيد عند إتمام الطلب.
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void refetchWallet()} hitSlop={8}>
              <ThemedText
                variant="footnote"
                style={{ color: colors.warning, textDecorationLine: "underline" }}
              >
                إعادة المحاولة
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {insufficient ? (
          <View
            accessibilityRole="alert"
            style={{
              marginTop: spacing.sm,
              padding: spacing.md,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: `${colors.error}1A`,
              borderWidth: 1,
              borderColor: `${colors.error}38`,
              gap: spacing.xs,
            }}
          >
            <ThemedText
              variant="footnote"
              style={{ color: colors.error, fontVariant: ["tabular-nums"] }}
            >
              {`رصيد المحفظة غير كافٍ (الناقص ${formatCurrency(
                roundToCents(comparisonTotal - (balance ?? 0)),
              )}).`}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="اشحن المحفظة"
              onPress={() => router.navigate("/(tabs)/(wallet)")}
              hitSlop={4}
            >
              <ThemedText
                variant="footnote"
                style={{
                  color: colors.error,
                  textDecorationLine: "underline",
                  fontFamily: "ReadexPro-SemiBold",
                }}
              >
                اشحن المحفظة ثم عُد لإتمام الطلب
              </ThemedText>
            </Pressable>
            <ThemedText variant="micro" style={{ color: colors.error }}>
              يُعتمد الشحن عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل.
            </ThemedText>
          </View>
        ) : null}
      </Card>

      {/* ── Coupon (useValidateCoupon on submit) ── */}
      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: spacing.md,
          }}
        >
          <Icon sf="tag.fill" md="sell" size={16} color={colors.onSurface} />
          <ThemedText variant="headline">كوبون خصم</ThemedText>
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            (اختياري)
          </ThemedText>
        </View>

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <TextInput
            value={coupon}
            onChangeText={(value) => {
              // Any edit voids the stored pre-check result (the label must
              // never show a total validated for a different code); the
              // generation bump also kills an in-flight validate for the
              // OLD code.
              setCoupon(value.toUpperCase());
              couponGenerationRef.current += 1;
              setAppliedCoupon(null);
              setCouponNotice(null);
            }}
            placeholder="أدخل رمز الكوبون"
            placeholderTextColor={colors.onSurface}
            accessibilityLabel="رمز الكوبون"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={64}
            textAlign="left"
            style={[inputStyle, { flex: 1 }]}
          />
          {appliedCoupon ? (
            <Button
              variant="secondary"
              title="إزالة"
              onPress={clearAppliedCoupon}
              accessibilityHint="إزالة الكوبون المطبق"
            />
          ) : (
            <Button
              variant="secondary"
              title={couponChecking ? "جارٍ التحقق…" : "تحقق"}
              loading={couponChecking}
              disabled={!coupon.trim() || couponChecking || isEmpty}
              onPress={() => void applyCoupon()}
              accessibilityHint="التحقق من صلاحية الكوبون"
            />
          )}
        </View>

        {couponNotice && !appliedCoupon ? (
          <ThemedText
            variant="footnote"
            selectable
            style={{ color: colors.error, marginTop: spacing.sm }}
            accessibilityRole="alert"
          >
            {couponNotice}
          </ThemedText>
        ) : null}

        {appliedCoupon ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              marginTop: spacing.sm,
            }}
          >
            <Icon sf="checkmark.circle.fill" md="check_circle" size={14} color={colors.success} />
            <ThemedText variant="footnote" style={{ direction: "ltr" }} selectable>
              {appliedCoupon.code}
            </ThemedText>
            <ThemedText
              variant="footnote"
              selectable
              style={{
                color: colors.success,
                fontVariant: ["tabular-nums"],
                fontFamily: "ReadexPro-SemiBold",
              }}
            >
              {`— خصم ${formatCurrency(appliedCoupon.discount_amount)}`}
            </ThemedText>
          </View>
        ) : null}

        <ThemedText variant="micro" style={{ color: colors.onSurface, marginTop: spacing.sm }}>
          يُتحقَّق من الكوبون ويُطبَّق على المنتجات المؤهلة عند إتمام الطلب.
        </ThemedText>
      </Card>

      {/* ── Summary (the receipt) + the confirm CTA ── */}
      <Card raised>
        <ThemedText variant="headline" style={{ marginBottom: spacing.md }}>
          ملخص الطلب
        </ThemedText>

        <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
          {items.map((line) => (
            <SummaryLine key={lineKeyOf(line)} line={line} appliedCoupon={appliedCoupon} />
          ))}
        </View>

        <View style={{ marginVertical: spacing.sm }}>
          <Divider />
        </View>

        <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <ThemedText variant="subhead" style={{ color: colors.onSurface }}>
              المجموع الفرعي
            </ThemedText>
            <ThemedText variant="subhead" selectable style={{ fontVariant: ["tabular-nums"] }}>
              {formatCurrency(totalLYD)}
            </ThemedText>
          </View>
          {appliedCoupon ? (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <ThemedText variant="subhead" style={{ color: colors.onSurface }}>
                خصم الكوبون
              </ThemedText>
              <ThemedText
                variant="subhead"
                selectable
                style={{ color: colors.success, fontVariant: ["tabular-nums"] }}
              >
                {`−${formatCurrency(appliedCoupon.discount_amount)}`}
              </ThemedText>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: spacing.sm,
              marginTop: spacing.xs,
            }}
          >
            <ThemedText variant="headline">
              {appliedCoupon ? "الإجمالي بعد الكوبون" : "الإجمالي"}
            </ThemedText>
            <ThemedText
              variant="headline"
              selectable
              style={{ fontVariant: ["tabular-nums"], fontFamily: "ReadexPro-Bold" }}
            >
              {formatCurrency(comparisonTotal)}
            </ThemedText>
          </View>
        </View>

        {/* Persistent money-failure banner (an error here must be
            actionable, not a toast). */}
        {orderError ? (
          <View
            accessibilityRole="alert"
            style={{
              marginBottom: spacing.md,
              padding: spacing.md,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: `${colors.error}1A`,
              borderWidth: 1,
              borderColor: `${colors.error}38`,
              gap: spacing.xs,
            }}
          >
            {partialCount > 0 ? (
              <>
                <ThemedText
                  variant="footnote"
                  style={{ color: colors.error, fontFamily: "ReadexPro-SemiBold" }}
                >
                  {`تم إنشاء ${arabicCount(partialCount, ORDER_COUNT_FORMS_OBJECT)} بنجاح قبل توقف العملية.`}
                </ThemedText>
                <ThemedText variant="footnote" selectable style={{ color: colors.error }}>
                  {orderError}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.navigate("/(tabs)/(orders)")}
                  hitSlop={4}
                >
                  <ThemedText
                    variant="footnote"
                    style={{ color: colors.error, textDecorationLine: "underline" }}
                  >
                    راجع طلباتك المنشأة
                  </ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <ThemedText
                  variant="footnote"
                  style={{ color: colors.error, fontFamily: "ReadexPro-SemiBold" }}
                >
                  {`تعذّر إتمام الطلب: ${orderError}`}
                </ThemedText>
                {/* R161-G: the claim is only honest when this screen knows
                    no charge landed — a skip means another surface owned
                    some units' wallet math. */}
                {!walletStateUnknown ? (
                  <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
                    لم يتم خصم أي مبلغ. راجع الرصيد والمخزون ثم أعد المحاولة.
                  </ThemedText>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.navigate("/(tabs)/(account)/support")}
                  hitSlop={4}
                >
                  <ThemedText
                    variant="footnote"
                    style={{ color: colors.error, textDecorationLine: "underline" }}
                  >
                    مشكلة في الطلب؟ تواصل مع الدعم
                  </ThemedText>
                </Pressable>
              </>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق رسالة الخطأ"
              onPress={() => setOrderError(null)}
              hitSlop={8}
              style={{ alignSelf: "flex-start", marginTop: spacing.xs }}
            >
              <ThemedText
                variant="micro"
                style={{ color: colors.onSurface, textDecorationLine: "underline" }}
              >
                إغلاق رسالة الخطأ
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <Button
          title={confirmLabel}
          size="lg"
          disabled={!canSubmit}
          accessibilityHint="تنفيذ عملية الشراء — يُخصم المبلغ من رصيد المحفظة"
          onPress={() => void handleConfirm()}
        />

        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, textAlign: "center", marginTop: spacing.md }}
        >
          الدفع يُخصم من رصيد محفظتك فوراً — تسليم فوري بعد التأكيد
        </ThemedText>
      </Card>
    </ScrollView>
  );
}
