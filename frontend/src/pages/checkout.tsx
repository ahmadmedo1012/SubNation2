// R111-F1 G1: the checkout-shaped skeleton shell (same max-w-5xl +
// grid geometry as this page) for the cart-hydration guard below.
import { RouteSkeleton } from "@/components/ui/route-skeleton";
// R136 (FE-2 decomposition): the page's pure money-path modules and
// presentational extracts moved to @/components/checkout/* (verbatim
// moves — handleConfirm, every state atom, every effect and every
// handler stay HERE; the extracts render the byte-identical DOM they
// rendered inline yesterday). Import surface:
//   • checkout-errors / checkout-unit-key / coupon-quote / live-requote —
//     the page's pure modules
//   • PaymentMethodCard / CouponCard — the left-column cards
//   • CartSummaryAside (composing OrderErrorBanner + CheckoutCta) —
//     the summary aside
//
// R158 (hooks lane): the 98-F2 live-requote state machine (the three
// requote atoms + quotedProductIdsRef + the settle/requote loop) moved
// to @/hooks/useCheckoutRequote — the atoms' declarations and the
// effect are the hook's now (the r136 decomposition pin follows them
// there); handleConfirm, every other atom, effect and handler stays
// HERE.
import {
  apiErrorData,
  isCouponFailureMessage,
  isHttpApiError,
} from "@/components/checkout/checkout-errors";
import {
  checkoutUnitFingerprint,
  clearCheckoutUnitKey,
  loadCheckoutUnitKey,
  persistCheckoutUnitKey,
  purgeLegacyCheckoutUnitKeys,
} from "@/components/checkout/checkout-unit-key";
// R165 (the R162 ADR): the per-CONFIRM group token — ONE UUID reused by
// every unit-order of an attempt (incl. partial-failure retries), riding
// CreateOrderBody.order_group_id.
import {
  clearCheckoutGroupKey,
  loadCheckoutGroupKey,
  persistCheckoutGroupKey,
} from "@/components/checkout/checkout-group-key";
import { couponQuoteLines, validateCouponForLines } from "@/components/checkout/coupon-quote";
import { CouponCard, type AppliedCoupon } from "@/components/checkout/CouponCard";
import { CartSummaryAside } from "@/components/checkout/CartSummaryAside";
import { CheckoutCta } from "@/components/checkout/CheckoutCta";
import { OrderErrorBanner } from "@/components/checkout/OrderErrorBanner";
import { PaymentMethodCard } from "@/components/checkout/PaymentMethodCard";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/useSeo";
import { useCheckoutRequote } from "@/hooks/useCheckoutRequote";
import { useAuth } from "@/lib/auth";
import { readLiveCartItems, roundToCents, useCart, cartHasBlockingStock } from "@/lib/cart";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { ErrorCode } from "@workspace/error-codes";
import { ArrowRight, ShieldCheck, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createOrder,
  getGetMeQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
  getMe,
  useGetMe,
  type CreateOrderBody,
  type Order,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { formatCount } from "@/lib/utils";

/**
 * Checkout — the money path.
 *
 * Payment method is wallet-only BY DESIGN: the backend's POST /api/orders
 * reads only product_id + coupon_code and ALWAYS charges the wallet — a
 * "cash on delivery" option that the server silently drops (previously
 * selectable here) let users believe they would pay on delivery while the
 * wallet was charged anyway. Removing the fake option is the honest UX.
 */
export default function CheckoutPage() {
  // V3-A2: transactional funnel — never index (robots.txt also Disallows).
  const seoBlock = useSeo({
    title: "إتمام الطلب — SubNation",
    description: "أكمل عملية الدفع من محفظة SubNation.",
    path: "/checkout",
    robots: "noindex,follow",
  });
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { items, totalLYD, clear, removeItem, updateQuantity, reconcileLine, isLoaded } = useCart();
  const [coupon, setCoupon] = useState("");
  // R94-A1 #9 (P3): the pre-validated coupon result. checkout used to
  // fetch /coupons/validate (final_amount / discount_amount for THIS
  // basket), throw the body away, and label the confirm button with the
  // UN-discounted total — the user confirmed "105.00 د.ل" and was charged
  // 100.00. The stored result is invalidated whenever the coupon input or
  // the cart lines change (see the effect + onChange below); the server
  // re-validates on every unit order regardless.
  //
  // 98-F2 (R98-A3 F1 / P1): the shape now carries the PER-LINE finals —
  // the backend applies the coupon PER UNIT (each unit order's
  // computePricing resolves the coupon against THAT unit's basePrice),
  // so a basket-level final/discount pair alone was a lie for qty>1
  // lines (fixed 10 off 25 ×3 charged 45, labeled 65). final_amount /
  // discount_amount are the Σ of the per-line math (see
  // validateCouponForLines) — the same numbers the unit loop charges.
  // R136 (FE-2): the inline shape moved to CouponCard's exported
  // AppliedCoupon — one source for the page state + the summary/CTA props.
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R116-S2 (P3): the balance now rides the SEEDED useGetMe cache (the
  // shared /api/auth/me key Navbar/boot populate, 60 s staleTime) — a
  // raw duplicate fetch on every checkout mount was both an extra
  // request and a staleness hazard of its own. The post-purchase
  // refreshMeBalance() seeds this exact key with a no-store response,
  // so the balance chip re-renders the moment a unit is charged (that
  // has always been the mechanism — this page is now an observer of
  // it instead of a second writer).
  const {
    data: me,
    isLoading: balanceLoading,
    isError: balanceError,
  } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!token, staleTime: 60_000 },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });
  // Do NOT fake balance=0 — an absent/failed probe must render the
  // unknown marker («—») and the honest warning banner, never the
  // "insufficient balance" verdict for a solvent user.
  const balance =
    typeof me?.wallet_balance === "number" && Number.isFinite(me.wallet_balance)
      ? me.wallet_balance
      : null;
  // Persistent in-page failure banner (critical money errors must NOT
  // live in a 4-second toast). Cleared on a new submission attempt.
  const [orderError, setOrderError] = useState<string | null>(null);
  // Partial-success bookkeeping: orders that DID go through before a
  // failure — shown in the banner so the user knows what was charged.
  const [partialCount, setPartialCount] = useState(0);
  // R161-G (audit E#1, money honesty): set when a complete failure rode
  // units another tab already charged/removed mid-flight (the loop's
  // skippedByOtherTab) — the wallet state is UNKNOWN from this tab, so
  // the banner's «لم يتم خصم أي مبلغ» claim must not render. Same reset
  // points as partialCount (a new confirm starts from a clean verdict).
  const [walletStateUnknown, setWalletStateUnknown] = useState(false);
  // R115-I1 (A7 P3-5): per-unit progress for the submitting label — a
  // 5-unit basket runs N sequential POSTs (seconds on 3G) and the
  // spinner-only CTA read as "stuck". {current}/{total} rides the
  // existing per-unit loop counter below.
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  // Server-side hard cap mirrors the backend validation — protects the
  // per-unit purchase loop from a self-DoS via huge quantities (H7).
  const MAX_UNITS_PER_LINE = 99;

  useEffect(() => {
    if (!token) {
      navigate("/login?redirect=/checkout");
    }
  }, [token, navigate]);

  // Cart lines are part of the validation input (98-F2: per-line UNIT
  // prices) — any line/quantity/PRICE change voids the stored coupon
  // result so the "الإجمالي بعد الكوبون" label can never go stale. The
  // generation counter also discards an in-flight validate whose lines
  // were swapped mid-request (R98-01's async hole, mirrored here): a
  // late response must not resurrect math computed for a dead basket.
  const couponGenerationRef = useRef(0);
  useEffect(() => {
    couponGenerationRef.current += 1;
    setAppliedCoupon(null);
    setCouponNotice(null);
  }, [items]);

  // R158 (hooks lane): the 98-F2 live-requote state machine (the three
  // requote atoms + quotedProductIdsRef + the settle/requote loop)
  // moved to @/hooks/useCheckoutRequote — verbatim, same effect slot
  // as the inline effect it replaces (the call site sits where the
  // old effect block was, so effect execution order is unchanged).
  // The hook owns: pricingRecheckInFlight (canSubmit's re-quote gate
  // + the CTA's «جارٍ تحديث الأسعار…» label), pricesUpdatedNotice and
  // droppedLineNotices (CartSummaryAside's notice lines).
  const { pricingRecheckInFlight, pricesUpdatedNotice, droppedLineNotices } = useCheckoutRequote({
    token,
    isLoaded,
    items,
    removeItem,
    reconcileLine,
  });

  // r97 F-17(4) / 98-F2: the per-unit loop can take seconds (N sequential
  // POSTs on a 3G link). If the shopper leaves the page mid-loop (nav
  // link / browser back — wouter unmounts this component), the final
  // navigate(/orders/:code) used to yank them out of wherever they chose
  // to be. There is no in-page cancel affordance today (the confirm
  // button turns into a spinner; the nav stays interactive), so the
  // unmount cleanup IS the abandonment signal. The success toast
  // (App-level provider, still mounted) still reports completion, and
  // /orders lists the created orders either way.
  const abandonedRef = useRef(false);
  useEffect(() => {
    abandonedRef.current = false;
    return () => {
      abandonedRef.current = true;
    };
  }, []);

  // A wallet-method purchase only blocks on a CONFIRMED insufficient
  // balance — an unknown balance (probe failed) must not hard-block,
  // the server remains the source of truth on submission.
  // R94-A1 #1 (P2, FP gate): the comparison uses the CENT-ROUNDED total
  // (and the coupon-adjusted one when a pre-check succeeded — 98-F2:
  // now the per-unit-honest Σ, the number the loop actually charges). The
  // raw sum 8.33 × 6 = 49.980000000000004 made `49.98 < total` true for a
  // user whose balance was EXACTLY the total — a blocked purchase with
  // the nonsensical "الناقص 0.00 د.ل".
  const comparisonTotal = roundToCents(appliedCoupon ? appliedCoupon.final_amount : totalLYD);
  const insufficient =
    !balanceLoading && !balanceError && balance !== null && balance < comparisonTotal;
  const isEmpty = items.length === 0;

  /** R94-A1 #9 + 98-F2 (R98-A3 F1 / P1): pre-check the coupon against
   * EVERY line's unit price and KEEP the per-line result so the summary
   * and the CTA can state the post-coupon total before submission —
   * computed exactly as the backend's per-unit loop charges it. Mirrors
   * product.tsx's validateCoupon contract (single unit). */
  const applyCoupon = async () => {
    const code = coupon.trim().toUpperCase();
    if (!code || totalLYD <= 0) return;
    setCouponChecking(true);
    setCouponNotice(null);
    const lines = couponQuoteLines(items);
    // R98-01's async hole, mirrored: lines swapped mid-request must not
    // resurrect math computed for a dead basket.
    const generation = ++couponGenerationRef.current;
    try {
      // L5-1 (R143): the token argument is gone — the generated client
      // rides customFetch, whose bearer-token getter main.tsx registers
      // supplies auth (and the 20 s budget + boot-gate retry).
      const result = await validateCouponForLines(code, lines);
      if (generation === couponGenerationRef.current) {
        if (result.status === "network") {
          setAppliedCoupon(null);
          setCouponNotice("تعذّر التحقق من الكوبون — تحقّق من شبكتك ثم أعد المحاولة");
          return;
        }
        if (result.status === "invalid") {
          setAppliedCoupon(null);
          // 98-F2 (F1): the precise per-line Arabic reason — e.g. the
          // min-order rejection the BASKET-level pre-flight used to
          // green-light (min between the line's unit price and the
          // basket total). In a mixed basket, name the failing line.
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
      }
    } catch {
      // Network-level failure — inconclusive; nothing is applied.
      if (generation === couponGenerationRef.current) {
        setCouponNotice("تعذّر التحقق من الكوبون — تحقّق من شبكتك ثم أعد المحاولة");
      }
    } finally {
      setCouponChecking(false);
    }
  };

  const clearAppliedCoupon = () => {
    // 98-F2: supersede any in-flight validate for the removed code.
    couponGenerationRef.current += 1;
    setAppliedCoupon(null);
    setCouponNotice(null);
  };

  // R129-A1 (B-11): the CTA's blocked label — surfaced INSIDE the
  // disabled button so the reason lives on the control itself.
  const stockBlocked = useMemo(() => cartHasBlockingStock(items), [items]);

  // R-140-j (keyboard/focus): focus retention for the confirm flight's
  // FAILURE landing. The CTA's native `disabled` (the honest submitting
  // register — aria-busy + the «جارٍ المعالجة… N/M» label) drops focus
  // to <body> the moment the per-unit loop starts; when the loop ended
  // in failure (orderError mounted, the persistent role=alert banner)
  // focus sat dead at the page top — a keyboard buyer had to Tab the
  // whole page to reach the retry. The effect re-lands focus on the
  // re-enabled CTA (the LAST button in the outcome block: the banner's
  // optional dismiss precedes it) once the flight flag clears with an
  // error mounted. Success paths navigate away — nothing to restore;
  // a CTA that stays disabled (e.g. a post-partial-charge insufficient
  // balance) simply ignores the focus() call and the announced banner
  // carries the explanation.
  const moneyOutcomeRef = useRef<HTMLDivElement>(null);
  const confirmFlightRef = useRef(false);
  useEffect(() => {
    if (submitting) {
      confirmFlightRef.current = true;
      return;
    }
    if (!confirmFlightRef.current) return;
    confirmFlightRef.current = false;
    if (!orderError) return;
    const outcomeButtons = moneyOutcomeRef.current?.querySelectorAll<HTMLButtonElement>("button");
    const confirmCta =
      outcomeButtons && outcomeButtons.length > 0
        ? outcomeButtons[outcomeButtons.length - 1]
        : null;
    confirmCta?.focus();
  }, [submitting, orderError]);

  const canSubmit = useMemo(() => {
    if (!token || isEmpty || submitting) return false;
    if (insufficient) return false;
    // 98-F2 (R98-A3 F5): the live re-quote must land before the CTA
    // unlocks — otherwise the first seconds of the page still sell the
    // (possibly stale) snapshot total. customFetch's 20 s abort bounds
    // the wait; a failed re-quote FAILS OPEN (the flag still clears).
    if (pricingRecheckInFlight) return false;
    // R129-A1 (F1 wiring — B-11): a proven-unchargeable line (stock 0,
    // or quantity > snapshot) blocks the charge HERE — the failure
    // surfaces at the cart, not as a 409 mid-charge. The re-quote above
    // just refreshed these snapshots, so the verdict is current.
    // Unknown-snapshot lines never block (the server re-check answers).
    if (cartHasBlockingStock(items)) return false;
    return true;
  }, [token, isEmpty, submitting, insufficient, pricingRecheckInFlight, items]);

  /**
   * 93-C5 / sim P2 (navbar balance staleness after cart purchase):
   * every charged unit moved the wallet balance, but a plain
   * invalidate→refetch of /api/auth/me can be served from the browser
   * HTTP cache (private, max-age=30) with the pre-purchase body — the
   * Navbar's useGetMe chip then stayed stale until the next navigation
   * (product.tsx's single-buy only "worked" because its last /me fetch
   * was >30 s old by purchase time). Refresh me with cache:"no-store"
   * and seed the query cache DIRECTLY — no refetch race, every useGetMe
   * observer re-renders with the new wallet_balance immediately. Falls
   * back to a plain invalidation if the refresh itself fails.
   */
  const refreshMeBalance = async () => {
    try {
      const freshUser = await getMe({ cache: "no-store" });
      queryClient.setQueryData(getGetMeQueryKey(), freshUser);
    } catch {
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    }
  };

  async function handleConfirm() {
    // AUD103-2-F8 (r103): synchronous re-entry guard — two clicks in one
    // frame both entered before the CTA's disabled re-render; the shared
    // per-unit keys dedupe them server-side, but that must stay a
    // defense-in-depth, not the guard itself (product.tsx already does
    // this with buyPending).
    if (!token || items.length === 0 || submitting) return;
    setSubmitting(true);
    setOrderError(null);
    setPartialCount(0);
    setWalletStateUnknown(false);
    // R115-I1 (A7 P3-5): the honest denominator for «جارٍ المعالجة… N/M»
    // — the SAME clamp the loop below charges (MAX_UNITS_PER_LINE).
    setSubmitProgress({
      current: 0,
      total: items.reduce((sum, it) => sum + Math.min(it.quantity, MAX_UNITS_PER_LINE), 0),
    });
    // AUD103-2-F1 (r103): sweep inert pre-r103 slot entries (hygiene,
    // off the money path).
    purgeLegacyCheckoutUnitKeys();
    // R165 (the R162 ADR §2.1.1): ONE group token per confirm attempt —
    // minted here (or reused from a live partial-failure retry of the
    // same basket — the subset-tolerant load), persisted for the next
    // retry, and sent on EVERY unit body below. Cleared ONLY at the
    // full-resolution point (liveAfterSync empty) or by TTL.
    const groupToken = loadCheckoutGroupKey(items) ?? generateIdempotencyKey();
    persistCheckoutGroupKey(items, groupToken);
    const created: Order[] = [];
    let firstOrderCode: string | null = null;
    let failureMessage: string | null = null;
    let couponFailure = false;
    // L5-3 (R143): a definitive INSUFFICIENT_BALANCE rejection proves the
    // cached me.wallet_balance is stale-high — recorded here so the
    // complete-failure branch can reseed the me cache (the balance chip
    // and the client-side insufficient gate both key off it; without the
    // refresh they contradicted the server's verdict on screen until the
    // 60 s staleTime + a remount).
    let insufficientBalanceRejection = false;
    // AUD103-2-F2 (r103): units skipped because the LIVE cart no longer
    // contains them (another tab completed/removed the line while this
    // loop iterates its stale snapshot).
    let skippedByOtherTab = 0;
    // Per-line bookkeeping of units that ACTUALLY got ordered (P0-3). A
    // mid-line failure (e.g. unit 2 of 3) previously left the full qty=3
    // in the cart while 1 unit was already charged — a retry then bought
    // 3 more units = 4 charges for 3 products. The cart must mirror
    // exactly what was charged: fully-ordered lines are removed,
    // partially-ordered lines keep only the unordered remainder.
    const orderedUnitsByLine = new Map<
      string,
      { productId: number; variantId: number | null; units: number }
    >();
    const couponCode = coupon.trim().toUpperCase();

    try {
      // 93-C5 / F-15 (A4 #9) + 98-F2 (R98-A3 F1 / P1): pre-flight the
      // coupon BEFORE the per-unit loop charges anything. Deterministic
      // coupon failures (invalid / inactive / expired / maxed /
      // min-order) previously surfaced mid-loop — after some units had
      // already been charged ("guaranteed partial failure" for a qty≥2
      // line: the first unit consumes a single-use coupon's only slot,
      // every following unit fails). 98-F2: the pre-flight is PER LINE
      // (each line's UNIT price — the exact input the backend's per-unit
      // pricing runs against) so a min-order coupon sitting between a
      // line's unit price and the basket total is rejected UP FRONT
      // instead of green-lighting a checkout that then 400s on every
      // unit. A network failure is inconclusive → fail-open: the server
      // re-validates the coupon on every unit order anyway.
      if (couponCode) {
        // Skip the pre-flight when THIS exact code was already validated
        // against the current basket (applyCoupon above) — the server
        // re-validates on every unit order anyway.
        if (appliedCoupon?.code !== couponCode) {
          const result = await validateCouponForLines(couponCode, couponQuoteLines(items));
          if (result.status === "invalid") {
            const message =
              items.length > 1 ? `${result.lineName} — ${result.message}` : result.message;
            setOrderError(
              `الكوبون: ${message} — أزل الكوبون أو صحّحه ثم أعد المحاولة. لم يتم خصم أي مبلغ.`,
            );
            toast({
              title: "تعذّر تطبيق الكوبون",
              description: message,
              variant: "destructive",
            });
            return;
          }
          if (result.status === "valid") {
            // Adopt the honest per-line math for the label + balance gate
            // as well (the loop below still charges server-side numbers).
            setAppliedCoupon({
              code: couponCode,
              lineUnitFinals: result.lineUnitFinals,
              final_amount: result.finalAmount,
              discount_amount: result.discountAmount,
            });
          }
          // "network" — inconclusive, fail-open (see above).
        }
      }

      for (const it of items) {
        const unitsWanted = Math.min(it.quantity, MAX_UNITS_PER_LINE);
        let unitsOrdered = 0;
        // 98-F2 (r97 F-07): the line-level intent fingerprint for this
        // unit's key — product / variant / coupon / effective unit price
        // (the body the backend's 409 branch compares + the price a
        // reconciliation may change).
        const lineFingerprint = checkoutUnitFingerprint(it, couponCode);
        // `CreateOrderBody` accepts a single product_id with quantity 1
        // per order — a qty>1 cart line becomes N unit orders.
        for (let unit = 0; unit < unitsWanted; unit++) {
          // AUD103-2-F2 (r103): multi-tab guard. `items` is a snapshot
          // taken when the loop started; another tab completing this same
          // cart clears its lines + keys in ITS cart-sync, and this loop
          // would then mint FRESH keys for the remaining units — each
          // "valid" per-request, i.e. duplicate orders. Re-read the LIVE
          // cart before every unit: if the line is gone or its remaining
          // quantity no longer covers this unit, the unit was accounted
          // for elsewhere — skip it. A null read (storage unavailable)
          // skips the guard entirely (pre-fix behavior).
          const liveCart = readLiveCartItems();
          if (liveCart) {
            const liveLine = liveCart.find(
              (l) =>
                l.productId === it.productId && (l.variantId ?? null) === (it.variantId ?? null),
            );
            if (!liveLine || liveLine.quantity <= unit) {
              skippedByOtherTab++;
              break;
            }
          }
          const body: CreateOrderBody = { product_id: it.productId };
          // R165 (the R162 ADR): the attempt's group token rides EVERY
          // unit body — the server records it verbatim on the order row
          // (informational grouping; never money math / idempotency /
          // refunds). Same token for all units + the partial-retry path,
          // so one logical checkout stays ONE group server-side.
          body.order_group_id = groupToken;
          // R115-I1 (A7 P3-5): reflect the unit about to be charged in
          // the CTA label («جارٍ المعالجة… 2/3») — the counter is the
          // existing loop's unit index, accumulated across lines.
          setSubmitProgress((p) => (p ? { ...p, current: p.current + 1 } : p));
          // Catalog-2026-09-20: the line's SELECTED variant rides every unit
          // order — the checkout charges exactly the option the shopper
          // chose on the product page (server falls back to the cheapest
          // variant when absent, but we always send it explicitly).
          if (it.variantId != null) body.variant_id = it.variantId;
          if (couponCode) body.coupon_code = couponCode;
          // 96-F4 (R96 A4 §2.2): one STABLE Idempotency-Key per unit order —
          // minted lazily on the unit's first attempt, persisted in
          // localStorage (durable — see the docblock above), and reused
          // verbatim when this exact unit is
          // retried. A network retry / double-click of an unresolved unit now
          // replays the cached server response instead of charging the wallet
          // twice, while different units — and a genuinely NEW confirm intent
          // after a definitive resolution — stay distinct because resolved
          // keys are cleared (see the helpers' docblock for the lifecycle).
          // Round-4: raw fetch("/api/orders") replaced by the orval-generated
          // createOrder() — per-call RequestInit carries the per-unit
          // Idempotency-Key, and the typed Order response kills the local
          // CreatedOrder interface. Auth rides the shared customFetch wiring
          // (cookie session + global bearer-token getter from main.tsx).
          const unitKey =
            loadCheckoutUnitKey(it.productId, it.variantId ?? null, unit, lineFingerprint) ??
            generateIdempotencyKey();
          persistCheckoutUnitKey(
            it.productId,
            it.variantId ?? null,
            unit,
            lineFingerprint,
            unitKey,
          );
          try {
            const order = await createOrder(body, {
              headers: { "Idempotency-Key": unitKey },
            });
            created.push(order);
            unitsOrdered++;
            // 2xx success — the unit is resolved, but the key is NOT deleted
            // here: if a LATER unit network-fails, the cart-sync below is
            // skipped and a retry must replay this unit (not re-charge it).
            // The sync step deletes it once the charge is accounted in cart.
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
            // ApiError.data = {error, code} — NEVER `.message` (P0-2).
            // 93-C5 / F-15: prefer the envelope's specific Arabic sentence
            // over the code map (coupon failures map to INVALID_DATA →
            // "بيانات غير صالحة", which reads like a money error).
            // 99-M1 (R99-A2 P1 — money): a 409 IDEMPOTENCY_IN_FLIGHT is NOT
            // a definitive rejection — it means another request with this
            // SAME key is still executing server-side (this attempt merely
            // raced it, e.g. a double-tap that the client cancelled). The
            // stored key must SURVIVE so the retry replays the same intent;
            // clearing it here would mint a fresh key on retry and
            // DOUBLE-CHARGE the unit once the in-flight request commits.
            // The backend's Arabic message explicitly tells the user to
            // retry — this guard makes that retry safe.
            if (apiErrorData(e)?.code !== ErrorCode.IDEMPOTENCY_IN_FLIGHT) {
              // 96-F4 (A4 §2.2): the rejection is definitive — clear this
              // unit's stored key so a retry isn't answered forever by the
              // cached error response.
              clearCheckoutUnitKey(it.productId, it.variantId ?? null, unit);
            }
            // L5-3 (R143): flag the balance-class rejection for the me
            // reseed below (see the declaration).
            if (apiErrorData(e)?.code === ErrorCode.INSUFFICIENT_BALANCE) {
              insufficientBalanceRejection = true;
            }
            // R120-B5 (copy): the تعذّر-family fallback — the vague
            // «فشل في إنشاء الطلب» sat below the app's calm + actionable
            // error-copy bar (the same family as «تعذّر التحقق من
            // رصيدك» / «تعذّر تطبيق الكوبون» on this page).
            failureMessage =
              apiErrorData(e)?.error || getErrorMessage(e) || "تعذّر إنشاء الطلب — حاول مرة أخرى";
            couponFailure = isCouponFailureMessage(failureMessage ?? undefined);
            break;
          }
        }
        if (unitsOrdered > 0)
          orderedUnitsByLine.set(`${it.productId}:${it.variantId ?? 0}`, {
            productId: it.productId,
            variantId: it.variantId ?? null,
            units: unitsOrdered,
          });
        if (failureMessage) break;
      }

      // 93-C5 / F-15 (A4 #9): coupon-family failures get explicit recovery
      // guidance — a single-use coupon that died mid-loop (its first unit
      // consumed the last slot) leaves the dead code in the input, and a
      // plain retry would re-fail on the same units forever. Clear it so
      // the retry completes the remainder at full price (never silently:
      // the confirm button shows the undiscounted total, and the banner
      // explains exactly what happened).
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
      // (productId + variantId): a cart may hold two variants of the same
      // product as separate lines, and the old productId-only lookup
      // shrunk only the first one.
      orderedUnitsByLine.forEach(({ productId, variantId, units }) => {
        // G-5 / L5-4 (R143): read the LIVE line at SYNC time, not the
        // stale render snapshot — `items` is what the loop STARTED from,
        // and updateQuantity is an absolute set, so a quantity RAISE in
        // another tab mid-flight (2→3, this loop bought 2) used to be
        // silently discarded (the sync set the live line to 0/removed
        // it). The live read keeps the un-purchased raise: 3 − 2 = 1
        // survives. Same discipline as the G-3 removeIfStillSameIntent
        // guard and the per-unit multi-tab re-read above; a null live
        // read (storage unavailable) falls back to the snapshot's line
        // (the pre-fix behavior).
        const liveCart = readLiveCartItems();
        const liveLine = liveCart?.find(
          (l) => l.productId === productId && (l.variantId ?? null) === variantId,
        );
        const line =
          liveLine ??
          items.find((i) => i.productId === productId && (i.variantId ?? null) === variantId);
        if (!line) return;
        if (units >= line.quantity) removeItem(productId, variantId);
        else updateQuantity(productId, line.quantity - units, variantId);
        // 96-F4 (R96 A4 §2.2): the charged units are now ACCOUNTED in the
        // cart (line removed / shrunk to the remainder) — their retry keys
        // are resolved and can be cleared. This is the ONLY success-side
        // deletion point: the network-failure path above skips the sync
        // precisely so a retry replays those units instead of re-charging.
        for (let unit = 0; unit < units; unit++) {
          clearCheckoutUnitKey(productId, variantId, unit);
        }
      });

      // Every unit that was charged moved the wallet balance — refresh the
      // me cache with an HTTP-cache-bypassing fetch (see refreshMeBalance)
      // and the other money caches so they don't stay stale for up to
      // 60 s (staleTime with refetchOnWindowFocus/reconnect disabled).
      // product.tsx does the same after its single-unit purchase.
      if (created.length > 0) {
        await refreshMeBalance();
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        // 93-C5 (A4 #20): the orders list (home's "آخر الطلبات" strip + the
        // /orders page) must reflect the purchase immediately, not ≤60 s
        // later. No-arg form invalidates every list param variant.
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        // R130 (A5-F3): the purchase just consumed real stock — the PDP
        // and catalog lists held pre-purchase stock_count/is_available
        // for up to their 3-min staleTime. Invalidate the catalog
        // surfaces the same way the money caches are invalidated (the
        // no-arg prefix form hits every product-by-slug/list variant).
        queryClient.invalidateQueries({ queryKey: ["product-by-slug"] });
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      }

      if (failureMessage && created.length === 0) {
        // Complete failure — persistent in-page banner + toast cue.
        // L5-3 (R143): a definitive INSUFFICIENT_BALANCE verdict proves
        // the cached balance is stale-high — reseed the me cache (no-store
        // probe) so the balance chip and the client-side «الناقص» gate
        // recompute from the FRESH figure instead of contradicting the
        // banner for the rest of the visit (60 s staleTime, no
        // refetchOnWindowFocus). Fired un-awaited so the banner + toast
        // land immediately; the chip recomputes when the probe resolves.
        if (insufficientBalanceRejection) {
          void refreshMeBalance();
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        }
        // R161-G (audit E#1): skips mean another tab charged/removed
        // units during this flight — this tab cannot honestly claim
        // «لم يتم خصم أي مبلغ» (the wallet view may contradict it).
        setWalletStateUnknown(skippedByOtherTab > 0);
        setOrderError(failureMessage);
        toast({ title: failureMessage, variant: "destructive" });
      } else if (failureMessage && created.length > 0) {
        // Partial success: some orders were charged, then one failed.
        // Tell the user EXACTLY what happened — never silently retry.
        setPartialCount(created.length);
        setOrderError(failureMessage);
      } else if (created.length === 0 && skippedByOtherTab > 0) {
        // AUD103-2-F2 (r103): every unit was completed by another tab
        // (its cart-sync removed the lines before this loop reached
        // them). Informative outcome — the orders exist, they were just
        // placed from the other tab.
        toast({
          title: "اكتمل الشراء من نافذة أخرى",
          description: "تم إنشاء طلباتك هناك وستجدها في صفحة طلباتك",
        });
        // R151: gate the redirect with abandonedRef — the full-success
        // branch (below) guards `navigate` with `!abandonedRef.current`
        // so a shopper who left /checkout mid-loop isn't yanked back. The
        // skippedByOtherTab branch re-introduced that yank: if the user
        // navigated away, the async closure fires navigate("/orders")
        // after unmount. Same guard as the success path.
        if (!abandonedRef.current) navigate("/orders");
      } else {
        // Full success.
        // G-5 / L5-4 (R143): clear() only when the sync actually emptied
        // the LIVE cart. The unconditional clear used to discard a
        // mid-flight quantity raise from another tab (2→3 while this
        // loop bought the snapshot's 2) even after the sync had already
        // preserved the 1-unit remainder — the raise is a NEW purchase
        // intent this confirm never saw, not this intent's business to
        // delete. A null live read (storage unavailable) falls back to
        // the old unconditional clear.
        const liveAfterSync = readLiveCartItems();
        if (liveAfterSync === null || liveAfterSync.length === 0) {
          clear();
          // R165 (the R162 ADR §2.1.1): the attempt fully resolved — the
          // group token's lifecycle ends with the basket that minted it
          // (same guard as clear(); partial failures keep it so the
          // retry's remaining units stay in the SAME group).
          clearCheckoutGroupKey();
        }
        toast({
          title: "تم إتمام الطلب",
          description: `تم إنشاء ${formatCount(created.length, {
            one: "طلب",
            two: "طلبين",
            few: "طلبات",
            many: "طلباً",
            other: "طلب",
          })} بنجاح`,
        });
        if (firstOrderCode && !abandonedRef.current) {
          // R161-G (multi-order honesty, the R160 NO-GO): with >1 created
          // order NO single receipt tells the story — order-detail shows
          // only firstOrderCode and never mentions the N−1 siblings. Land
          // on /orders instead (this page's own skippedByOtherTab
          // precedent): the toast above already counts every order, and
          // /orders lists them all newest-first with codes + amounts.
          navigate(created.length > 1 ? "/orders" : `/orders/${firstOrderCode}`);
        }
        // r97 F-17(4) / 98-F2: the shopper left mid-loop — the loop still
        // finished and the toast above reported it, but the redirect is
        // skipped (their navigation decision stands).
      }
    } catch (e) {
      // Network-level abort (rethrown from the unit loop). If any unit
      // was already charged, the wallet moved too — refresh the same
      // caches even though the cart-sync was (deliberately) skipped.
      if (created.length > 0) {
        await refreshMeBalance();
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        // R161-G (audit E#3, P4): mirror the try-side partial path — the
        // charged units consumed real stock, so a network-partial must
        // refresh the PDP/catalog caches too (else they serve stale
        // stock_count/is_available for up to their 3-min staleTime).
        queryClient.invalidateQueries({ queryKey: ["product-by-slug"] });
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      }
      const msg = getErrorMessage(e);
      // R160 (audit F1): mirror the HTTP-partial branch above — a
      // network abort AFTER ≥1 confirmed unit is a PARTIAL outcome,
      // never "nothing was deducted". Without setPartialCount the
      // banner fabricated a full-refund claim («لم يتم خصم أي مبلغ»)
      // that the wallet view immediately contradicts; created[] holds
      // confirmed 2xx Order objects, so the partial branch's
      // «راجع طلباتك المنشأة» link is the honest verdict. The toast
      // follows the HTTP-partial register too (banner-only).
      if (created.length > 0) setPartialCount(created.length);
      setOrderError(msg);
      if (created.length === 0) toast({ title: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  }

  // R115-I1 (A7 P3-11): guests get the checkout-shaped RouteSkeleton
  // instead of a bare null — the redirect effect above navigates to
  // /login on the next tick, and that white flash on the money funnel
  // read as a blank page on slow links (same shape the cart-hydration
  // guard below renders).
  if (!token) return <RouteSkeleton shape="checkout" />;

  // R111-F1 G1 (P3): cart-hydration guard — mirrors cart.tsx:122. The
  // cart reads localStorage in a mount effect; until it flips
  // `isLoaded`, items=[] and the empty branch below rendered
  // «سلتك فارغة» for one paint on every deep link to /checkout with a
  // FULL cart — a false "your cart is empty" flash on the money
  // screen. The "checkout" skeleton shell mirrors this page's exact
  // two-column geometry (route-skeleton.tsx CheckoutShell), so the
  // swap-in is a content-fill, not a layout jump.
  if (!isLoaded) {
    return <RouteSkeleton shape="checkout" />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {seoBlock}
      {/* Back-to-cart — R160 (audit F10): the funnel's first in-page
          escape (order-detail's back-row idiom; the stock-blocked CTA
          says «راجع السلة» but its only affordances lived in chrome —
          the Navbar icon / mobile bottom-nav). A real <Link> so it is
          keyboard-operable and middle-clickable. */}
      <Link
        href="/cart"
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        سلة المشتريات
      </Link>
      <div className="flex items-center gap-3 mb-7 page-in">
        <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
          <ShoppingBag className="w-5 h-5 text-primary" />
        </div>
        <div>
          {/* R128-A4 (F-3): leading-tight removed — the base h1 1.3
              Arabic-safe floor owns the leading (same as cart's h1). */}
          <h1 className="text-2xl font-bold">إتمام الطلب</h1>
          <p className="text-sm text-muted-foreground">راجع مشترياتك وأكمل عملية الدفع</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
        {/* Payment details (left on desktop) */}
        {/* R160 (audit F6): the whole left column is payment machinery —
            with an EMPTY basket there is nothing to pay and no coupon
            to apply, but the balance card + coupon + trust line still
            rendered above the aside's «سلتك فارغة», reading as a
            functional checkout for a phantom basket. Gate the column
            on !isEmpty (the aside keeps its droppedLineNotices hoist —
            those must announce regardless). */}
        {!isEmpty && (
          <div className="space-y-4">
            {/* Payment method — wallet only (see component docblock) */}
            <PaymentMethodCard
              balanceLoading={balanceLoading}
              balance={balance}
              balanceError={balanceError}
              insufficient={insufficient}
              comparisonTotal={comparisonTotal}
            />

            {/* Coupon */}
            <CouponCard
              coupon={coupon}
              appliedCoupon={appliedCoupon}
              couponChecking={couponChecking}
              couponNotice={couponNotice}
              isEmpty={isEmpty}
              onCouponChange={(value) => {
                // Any edit voids the stored pre-check result — the label
                // must never show a total validated for a different code
                // (the generation bump also kills an in-flight validate
                // for the OLD code — R98-01's async hole).
                setCoupon(value);
                couponGenerationRef.current += 1;
                setAppliedCoupon(null);
                setCouponNotice(null);
              }}
              onApplyCoupon={() => void applyCoupon()}
              onClearCoupon={clearAppliedCoupon}
            />

            {/* Trust */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-bold px-1">
              <ShieldCheck className="w-4 h-4 text-status-success" />
              <span>دفعتك آمنة ومشفّرة بالكامل</span>
            </div>
          </div>
        )}

        {/* Cart summary (right on desktop) */}
        {/* R138 (visual): the summary's receipt-metaphor polish (row
            rhythm, /20 hairline rules, the weight ladder, the terminal
            «الإجمالي» line, the family resting elevation) lives in
            CartSummaryAside — the r136 decomposition moved every
            presentational surface there; this page stays the
            orchestration core and renders byte-identical props. */}
        <CartSummaryAside
          droppedLineNotices={droppedLineNotices}
          pricesUpdatedNotice={pricesUpdatedNotice}
          isEmpty={isEmpty}
          items={items}
          totalLYD={totalLYD}
          appliedCoupon={appliedCoupon}
          comparisonTotal={comparisonTotal}
        >
          {/* Persistent money-failure banner: an error here must be
              actionable, not a 4-second toast. */}
          {/* R-140-j: classless focus-scope anchor for the confirm-flight
              effect above — no visual role (a plain block div around the
              banner + CTA the page composes here). */}
          <div ref={moneyOutcomeRef}>
            <OrderErrorBanner
              orderError={orderError}
              partialCount={partialCount}
              walletStateUnknown={walletStateUnknown}
              onDismiss={() => setOrderError(null)}
            />
            <CheckoutCta
              canSubmit={canSubmit}
              submitting={submitting}
              submitProgress={submitProgress}
              pricingRecheckInFlight={pricingRecheckInFlight}
              stockBlocked={stockBlocked}
              insufficient={insufficient}
              appliedCoupon={appliedCoupon}
              totalLYD={totalLYD}
              comparisonTotal={comparisonTotal}
              onConfirm={handleConfirm}
            />
          </div>
        </CartSummaryAside>
      </div>
    </div>
  );
}
