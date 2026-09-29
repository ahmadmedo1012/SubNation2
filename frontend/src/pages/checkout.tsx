import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// R111-F1 G1: the checkout-shaped skeleton shell (same max-w-5xl +
// grid geometry as this page) for the cart-hydration guard below.
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { readLiveCartItems, roundToCents, useCart, type LocalCartItem } from "@/lib/cart";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { ErrorCode } from "@workspace/error-codes";
import { formatCurrency } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createOrder,
  getGetMeQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
  getMe,
  getProduct,
  type CreateOrderBody,
  type Order,
  type Product,
  type User,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { formatCount } from "@/lib/utils";

// `/api/auth/me` returns the user FLAT ({...formatUser(user), linked_identities})
// — there is no `user` wrapper. The old `data?.user?.wallet_balance` read
// always evaluated to undefined -> balance 0 -> the confirm button was
// permanently disabled for every authed visitor (P0-1, live-confirmed).
// 98-F9: the local MeResponse interface is gone — the balance field is
// typed straight off the generated User contract.

function formatBalance(value: number | null | undefined): string {
  return formatCurrency(value ?? 0);
}

/**
 * customFetch throws `ApiError` (an Error subclass with `name: "ApiError"`)
 * for EVERY non-2xx HTTP response, and a browser `TypeError` for network-level
 * failures (DNS/offline/request never delivered). The distinction matters for
 * the partial-failure bookkeeping below: an HTTP failure means the server
 * DEFINITIVELY rejected this unit (safe to shrink the cart to the remainder),
 * while a network failure means the server state is UNKNOWN (the request may
 * have landed and charged the wallet) — the cart must be left untouched.
 */
function isHttpApiError(error: unknown): boolean {
  return error instanceof Error && error.name === "ApiError";
}

/**
 * The backend error envelope ({error, code}) carried by an ApiError.
 * 93-C5 / F-15 (A4 #9): the orders route maps several coupon failures to
 * the generic INVALID_DATA code, which getErrorMessage() flattens to
 * "بيانات غير صالحة" — a confusing money-looking error. Prefer the
 * backend's specific Arabic sentence on this path.
 */
function apiErrorData(error: unknown): { error?: string; code?: string } | null {
  if (!isHttpApiError(error)) return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as { error?: string; code?: string };
}

/**
 * Coupon-family failures (invalid / inactive / expired / maxed / exhausted)
 * — every one of the backend's coupon messages carries the word "كوبون".
 * 93-C5 / F-15 (A4 #9): used to special-case the recovery guidance.
 */
function isCouponFailureMessage(message: string | undefined): boolean {
  return typeof message === "string" && message.includes("كوبون");
}

/**
 * 96-F4 (R96 A4 §2.2 — money P1): stable per-unit Idempotency-Key storage.
 *
 * The unit loop below used to call generateIdempotencyKey() inline on every
 * confirm click, so a manual retry after a NETWORK-level failure (the outer
 * catch deliberately keeps the cart — server state unknown) minted NEW keys
 * for units whose request may already have committed → double charge on
 * flaky mobile links. The backend guard (Redis replay + durable in-tx check,
 * routes/orders.ts) can only dedupe when it sees the SAME key twice — so the
 * key must survive the retry attempt.
 *
 * Lifecycle (lazy — a key is minted only when its unit is first attempted):
 *   • read:   reuse a stored key when one exists → a retry of an unresolved
 *             unit replays the server's cached response instead of charging
 *             again (this is the double-charge fix).
 *   • write:  at generation time, under
 *             subnation_checkout_key:{productId}:{unitIndex}
 *   • delete: ONLY at a definitive resolution —
 *       - a per-unit HTTP rejection (ApiError): cleared in the catch below so
 *         a retry of that unit isn't answered forever by the cached error;
 *       - accounted 2xx successes: cleared in the cart-sync step, NOT at the
 *         per-unit 2xx. The network-failure path intentionally skips the
 *         cart-sync, so the cart still contains the already-charged units on
 *         retry — deleting their keys there would re-charge them under fresh
 *         keys. The sync step (which runs on every definitive flow outcome:
 *         partial HTTP failure AND full success) is the safe deletion point.
 *
 * localStorage (durable) rather than sessionStorage (per-tab) — R102
 * (R102-A1 F1 / P1): the cart itself lives in localStorage and survives
 * tab death, but the retry tokens used to die with the tab. Scenario the
 * sessionStorage choice opened: server commits the purchase → response
 * lost (network) → user closes the tab → cart still holds the charged
 * unit → re-confirm mints a FRESH key → the durable server layer sees a
 * new key → a full second purchase and a second debit.
 *
 * AUD103-2-F7 (r103) — scope honesty: the durability is BOUNDED by the
 * 98-F2 TTL below (10 minutes). A user returning MORE than 10 minutes
 * after a lost response still mints a fresh key (the stored one is
 * treated as a stale intent); that residual window is the documented
 * 98-F2 trade-off — a longer TTL would let ancient keys swallow
 * genuinely new purchases via the 24 h server replay window. Every
 * access is try/catch-guarded: a private-mode / quota failure just
 * degrades to the old unstable-key behavior, it never blocks the money
 * path.
 *
 * 98-F2 (r97 F-07, deferred queue): the raw key gained the 97-F5 buy-key's
 * TWO staleness guards, which the checkout keys never had — a stored key
 * lived until its terminal resolution, so a key minted hours/days earlier
 * in a long-lived tab could swallow a genuinely NEW purchase via the
 * server's 24 h replay window:
 *   • TTL: a key older than 10 minutes no longer represents the user's
 *     live intent and is ignored (minted fresh instead);
 *   • fingerprint: the line's product / variant / coupon / unit price —
 *     the exact body fields the backend's same-key-different-body 409
 *     branch compares, plus the price context (a post-reconcile price
 *     change is a NEW intent, never a replay of the old charge).
 */
const CHECKOUT_KEY_PREFIX = "subnation_checkout_key:";
/** 98-F2 (r97 F-07): retry-token TTL — mirrors the 97-F5 buy-key guidance. */
const CHECKOUT_KEY_TTL_MS = 10 * 60 * 1000;

interface StoredCheckoutUnitKey {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — productId | variantId | coupon | unit price. */
  f: string;
}

function checkoutUnitKeyId(productId: number, variantId: number | null, unitIndex: number): string {
  // AUD103-2-F1 (r103): the slot is LINE-scoped (productId + variantId).
  // The pre-fix `${productId}:${unitIndex}` slot collided across two cart
  // lines of the same product with different variants — the sibling
  // line's persist OVERWROTE an unresolved unit's durable key, so a retry
  // after a network failure minted a fresh key and DOUBLE-CHARGED that
  // unit (the 98-F2 fingerprint prevented wrong-variant replay but could
  // not prevent overwrite). Matches the cart lineKey convention
  // (lib/cart.tsx: `${productId}:${variantId ?? 0}`).
  return `${CHECKOUT_KEY_PREFIX}${productId}:${variantId ?? 0}:${unitIndex}`;
}

/** AUD103-2-F1 (r103): one-time sweep of pre-r103 slots (the un-scoped
 * `${productId}:${unitIndex}` shape — 2 numeric segments). They are inert
 * under the line-scoped reads; removing them keeps storage clean. Runs
 * lazily at the start of a confirm, never inside the money path. */
function purgeLegacyCheckoutUnitKeys(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CHECKOUT_KEY_PREFIX)) {
        const tail = k.slice(CHECKOUT_KEY_PREFIX.length);
        // New shape: "<pid>:<variant>:<unit>" (3 segments); legacy: 2.
        if (tail.split(":").length === 2) stale.push(k);
      }
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // ignore — hygiene only
  }
}

/** 98-F2 (r97 F-07): binds a stored unit key to WHAT that unit order buys
 * — mirrors product.tsx's buyIntentFingerprint (97-F5). */
function checkoutUnitFingerprint(
  line: Pick<LocalCartItem, "productId" | "variantId" | "priceLYD" | "salePriceLYD">,
  couponCode: string,
): string {
  const unitPrice = line.salePriceLYD ?? line.priceLYD;
  return `${line.productId}|${line.variantId ?? ""}|${couponCode.trim().toUpperCase()}|${unitPrice}`;
}

function loadCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
  fingerprint: string,
): string | null {
  try {
    const raw = localStorage.getItem(checkoutUnitKeyId(productId, variantId, unitIndex));
    if (!raw) return null;
    // Pre-98-F2 entries were raw uuid strings — JSON.parse throws → the
    // entry is treated as absent and a fresh key is minted (the old
    // un-stamped keys carry no TTL/fingerprint contract to honor).
    const parsed = JSON.parse(raw) as Partial<StoredCheckoutUnitKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    // TTL — a key minted >10 min ago is a stale intent, not this retry.
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > CHECKOUT_KEY_TTL_MS) return null;
    // Intent binding — the unit body (product/variant/coupon) or the
    // line's effective price changed since the key was minted: replaying
    // it onto the new data would either swallow a genuinely new purchase
    // or trip the backend's same-key-different-body 409.
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    return null;
  }
}

function persistCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
  fingerprint: string,
  key: string,
): void {
  try {
    const entry: StoredCheckoutUnitKey = { k: key, t: Date.now(), f: fingerprint };
    localStorage.setItem(checkoutUnitKeyId(productId, variantId, unitIndex), JSON.stringify(entry));
  } catch {
    // degraded: unstable keys (pre-fix behavior) — never throw on money path
  }
}

function clearCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
): void {
  try {
    localStorage.removeItem(checkoutUnitKeyId(productId, variantId, unitIndex));
  } catch {
    // ignore
  }
}

// ── 98-F2 (R98-A3 F1 / P1): per-line coupon validation ──────────────────────
//
// The pre-flight used to validate the coupon ONCE against the BASKET
// total while the backend applies it PER UNIT against each unit's
// basePrice (pricing.ts resolveCoupon + checkout.service computePricing
// per unit order; the unit loop below sends coupon_code on every unit):
//
//   • Scenario A — coupon min_order_amount between a line's unit price
//     and the basket total (e.g. min 30, unit 25, qty 3 → basket 75):
//     the basket-level pre-flight PASSED, then EVERY unit order failed
//     400 below_min_order — a guaranteed full failure after the UI had
//     just green-lit the checkout.
//   • Scenario B — fixed coupon with qty>1 (fixed 10, unit 25, qty 3):
//     the label showed discount 10 / total 65 while the server charged
//     3 × (25 − 10) = 45 (and consumed 3 redemption slots); the balance
//     gate compared the wrong number too.
//
// The pre-flight now validates per DISTINCT cart line, each with that
// line's UNIT price — the exact input the backend's per-unit pricing
// runs against — and the label/gate are computed from the per-unit
// finals exactly as the server charges them. The per-unit order POST
// loop semantics are untouched (the server stays authoritative and
// re-validates on every unit regardless).

interface CouponQuoteLine {
  /** Cart line key (`productId:variantId`) — mirrors lib/cart's lineKey. */
  lineKey: string;
  name: string;
  quantity: number;
  /** Effective unit price (sale ?? list) — the exact basePrice the
   * backend's per-unit coupon resolution runs against. */
  unitPrice: number;
}

/** 98-F2: the cart lines as coupon-validation inputs. */
function couponQuoteLines(items: LocalCartItem[]): CouponQuoteLine[] {
  return items.map((it) => ({
    lineKey: `${it.productId}:${it.variantId ?? 0}`,
    name: it.name,
    quantity: it.quantity,
    unitPrice: it.salePriceLYD ?? it.priceLYD,
  }));
}

type CouponQuoteResult =
  | {
      status: "valid";
      /** Per-unit post-coupon final, keyed by cart line key. */
      lineUnitFinals: Record<string, number>;
      /** Σ unitFinal × qty — exactly what the per-unit loop will charge. */
      finalAmount: number;
      /** basketBase − finalAmount, rounded so «المجموع الفرعي − خصم =
       * الإجمالي» stays arithmetically consistent on the label. */
      discountAmount: number;
    }
  | { status: "invalid"; message: string; lineName: string }
  | { status: "network" };

/**
 * 98-F2 (R98-A3 F1 / P1): validate a coupon against every DISTINCT cart
 * line's UNIT price and compute the per-unit-honest basket math.
 *
 * Deduplication: ONE request per DISTINCT unit price — the endpoint's
 * result is a pure function of (code, order_amount), so identical prices
 * share the answer. /api/coupons/validate is rate-limited 10/min/user
 * (the enumeration guard in app.ts); carts are small and same-price
 * lines never multiply the budget.
 *
 * Outcome contract:
 *   • "invalid" — at least one line fails (e.g. below_min_order): the
 *     coupon is invalid FOR THE BASKET and the precise Arabic reason for
 *     the first failing line (basket order) is returned. The confirm
 *     pre-flight aborts BEFORE any charge.
 *   • "network" — at least one request was network-level inconclusive:
 *     applyCoupon surfaces a retryable notice; the confirm pre-flight
 *     fails OPEN (the server re-validates the coupon on every unit
 *     order anyway — see the pre-flight block in handleConfirm).
 *   • "valid" — every line validated; per-unit finals are the same
 *     expression the backend charges per unit (validate's
 *     +(order_amount − discount).toFixed(2) === pricing.ts's
 *     +(basePrice − discount).toFixed(2)).
 */
async function validateCouponForLines(
  code: string,
  lines: CouponQuoteLine[],
  token: string | null,
): Promise<CouponQuoteResult> {
  const distinctPrices: number[] = [];
  for (const line of lines) {
    if (!distinctPrices.some((p) => p === line.unitPrice)) distinctPrices.push(line.unitPrice);
  }
  const responses = await Promise.all(
    distinctPrices.map(async (price) => {
      try {
        const res = await fetch("/api/coupons/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({ code, order_amount: price }),
        });
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        return { price, res, body };
      } catch {
        return { price, res: null, body: null };
      }
    }),
  );
  // ANY network-level failure leaves the coupon's applicability to the
  // basket UNKNOWN — inconclusive for the whole pre-flight.
  if (responses.some((r) => r.res === null)) return { status: "network" };
  // HTTP-level lookup per distinct price (res non-null after the guard;
  // the redundant check below keeps the narrowed type without an `as`).
  const byPrice = new Map<number, { res: Response; body: Record<string, unknown> | null }>();
  for (const r of responses) {
    if (!r.res) continue;
    byPrice.set(r.price, { res: r.res, body: r.body });
  }
  // First INVALID line in BASKET order — the error names the first line
  // the shopper sees, carrying the backend's precise Arabic reason.
  for (const line of lines) {
    const r = byPrice.get(line.unitPrice)!;
    if (!(r.res.ok && r.body && r.body.valid === true)) {
      const message =
        (r.body && typeof r.body.error === "string" && r.body.error) || "الكوبون غير صالح";
      return { status: "invalid", message, lineName: line.name };
    }
  }
  // Valid on every line — compute the per-unit honest math.
  const lineUnitFinals: Record<string, number> = {};
  let finalAmount = 0;
  let baseAmount = 0;
  for (const line of lines) {
    const r = byPrice.get(line.unitPrice)!;
    const unitFinal = Number(r.body?.final_amount);
    if (!Number.isFinite(unitFinal)) {
      return {
        status: "invalid",
        message: "استجابة تحقق غير صالحة — أعد المحاولة",
        lineName: line.name,
      };
    }
    const roundedUnitFinal = roundToCents(unitFinal);
    lineUnitFinals[line.lineKey] = roundedUnitFinal;
    finalAmount += roundedUnitFinal * line.quantity;
    baseAmount += line.unitPrice * line.quantity;
  }
  const total = roundToCents(finalAmount);
  const discount = roundToCents(roundToCents(baseAmount) - total);
  return { status: "valid", lineUnitFinals, finalAmount: total, discountAmount: discount };
}

// ── 98-F2 (R98-A3 F5 / P2): live re-quote of ONE cart line ───────────────────
//
// Cart price snapshots are taken at add-to-cart time (lib/cart.tsx);
// between add and confirm a flash sale can end (or start, or an operator
// reprices). The re-quote maps a cart line onto the /api/products/:id
// payload's LIVE pricing for the line's selected variant (or the
// product-level display price for variant-less lines — the server
// charges legacy variant-less orders the CHEAPEST active variant, which
// is exactly what the payload's product-level price carries).

type LiveLineResult =
  | {
      status: "priced";
      priceLYD: number;
      salePriceLYD: number | null;
      discountPercent: number | null;
      effectiveUnitPrice: number;
    }
  | { status: "unavailable" };

function quoteLineFromProduct(live: Product, line: LocalCartItem): LiveLineResult {
  // The line's selected option must still exist as an ACTIVE variant —
  // a foreign/inactive/deleted variant id fails CLOSED server-side
  // (checkout.service VARIANT_NOT_FOUND: "never silently ignored: the
  // client would be charged a price it never displayed").
  const variant =
    line.variantId != null ? (live.variants ?? []).find((v) => v.id === line.variantId) : undefined;
  if (line.variantId != null && !variant) return { status: "unavailable" };
  const priceLYD = variant ? variant.price : live.price;
  const salePriceLYD = variant ? (variant.sale_price ?? null) : (live.sale_price ?? null);
  const discountPercent = variant
    ? (variant.discount_percent ?? null)
    : (live.discount_percent ?? null);
  return {
    status: "priced",
    priceLYD,
    salePriceLYD,
    discountPercent,
    effectiveUnitPrice: salePriceLYD ?? priceLYD,
  };
}

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
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    /** Per-unit post-coupon final, keyed by lineKey (productId:variantId). */
    lineUnitFinals: Record<string, number>;
    final_amount: number;
    discount_amount: number;
  } | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);
  // 98-F2 (R98-A3 F5 / P2): mount-time live-price reconciliation state —
  // see the re-quote effect below for the full contract.
  const [pricingRecheckInFlight, setPricingRecheckInFlight] = useState(false);
  const [pricesUpdatedNotice, setPricesUpdatedNotice] = useState<string | null>(null);
  const [droppedLineNotices, setDroppedLineNotices] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState(false);
  // Persistent in-page failure banner (critical money errors must NOT
  // live in a 4-second toast). Cleared on a new submission attempt.
  const [orderError, setOrderError] = useState<string | null>(null);
  // Partial-success bookkeeping: orders that DID go through before a
  // failure — shown in the banner so the user knows what was charged.
  const [partialCount, setPartialCount] = useState(0);
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

  useEffect(() => {
    if (!token) return;
    let aborted = false;
    setBalanceLoading(true);
    setBalanceError(false);
    // 93-C5 / sim P2 (navbar balance staleness after cart purchase):
    // cache:"no-store" — /api/auth/me serves Cache-Control: private,
    // max-age=30, so this probe used to seed the browser HTTP cache with
    // the PRE-purchase balance seconds before purchase; the
    // post-purchase invalidate→refetch was then answered from that cache
    // and the Navbar kept showing the old balance. Don't poison it.
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("balance fetch failed");
        return res.json();
      })
      .then((data: Pick<User, "wallet_balance"> | null) => {
        if (aborted) return;
        setBalance(
          typeof data?.wallet_balance === "number" && Number.isFinite(data.wallet_balance)
            ? data.wallet_balance
            : null,
        );
      })
      .catch(() => {
        // Do NOT fake balance=0 — a failed probe used to render the
        // "insufficient balance" banner for solvent users. Show a
        // retry-able error instead of lying about the balance.
        if (!aborted) {
          setBalance(null);
          setBalanceError(true);
        }
      })
      .finally(() => {
        if (!aborted) setBalanceLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [token]);

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

  // 98-F2 (R98-A3 F5 / P2): re-quote every cart line from the LIVE
  // catalog before the confirm CTA unlocks. Cart snapshots are taken at
  // add-to-cart time (lib/cart.tsx) and were NEVER refreshed here — a
  // flash sale that ended between add and confirm had the shopper
  // approve "80.00 د.ل" while every unit charged the live 100.00.
  //
  // Contract (per DISTINCT product id, at most once per checkout visit):
  //   • price changed → reconcileLine refreshes the snapshot (quantity
  //     untouched) and ONE subtle notice «تم تحديث الأسعار حسب الأسعار
  //     الحالية» is shown — never a silent repricing;
  //   • product archived (404/410) / deactivated (is_active:false) /
  //     selected variant gone (VARIANT_NOT_FOUND server-side) → the
  //     line is dropped with its own notice (those orders 400 anyway);
  //   • fetch failure → fail-open (the snapshot stands; the server is
  //     the charge authority and surfaces any mismatch);
  //   • no change → silent.
  // The loop's mutations are lineKey-targeted (removeItem/reconcileLine
  // no-op on already-changed lines), so an items edit landing mid-flight
  // degrades safely; customFetch bounds each request with a 20 s abort
  // so the CTA gate below can never hang. New products arriving later
  // (cross-tab storage event) are picked up by the next run — each id is
  // quoted at most once per visit.
  const quotedProductIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!token || !isLoaded || items.length === 0) return;
    const pending = [...new Set(items.map((i) => i.productId))].filter(
      (id) => !quotedProductIdsRef.current.has(id),
    );
    if (pending.length === 0) return;
    pending.forEach((id) => quotedProductIdsRef.current.add(id));
    setPricingRecheckInFlight(true);
    // try/finally + .catch: the in-flight gate MUST clear even when the
    // re-quote dies before its first await (a synchronous throw out of
    // the client module — e.g. a mis-mocked or broken import — rejects
    // this promise before any fetch timeout can bound it). Without it
    // the CTA stayed «جارٍ تحديث الأسعار…» forever: fail-open is the
    // contract, and the server re-prices every unit order anyway.
    void (async () => {
      try {
        const settled = await Promise.allSettled(pending.map((id) => getProduct(id)));
        let anyPriceChanged = false;
        const dropped: string[] = [];
        const lineNotice = (line: LocalCartItem, productId: number) =>
          `${line.name.trim() || `#${productId}`} لم يعد متاحاً للشراء — أُزيل من الطلب.`;
        for (let i = 0; i < pending.length; i++) {
          const productId = pending[i];
          const result = settled[i];
          // A 404 (archived product) arrives as a rejected ApiError — the
          // only rejection class acted on; everything else is fail-open.
          if (result.status === "rejected") {
            const reason = result.reason as { name?: string; status?: number } | undefined;
            const archived =
              reason?.name === "ApiError" && (reason?.status === 404 || reason?.status === 410);
            if (archived) {
              for (const line of items) {
                if (line.productId !== productId) continue;
                dropped.push(lineNotice(line, productId));
                removeItem(productId, line.variantId);
              }
            }
            continue;
          }
          const live = result.value;
          if (live.is_active === false) {
            // Deactivated products are refused server-side
            // (PRODUCT_NOT_FOUND in checkout.service) while the detail
            // route still serves them for display — this is the honest
            // drop point.
            for (const line of items) {
              if (line.productId !== productId) continue;
              dropped.push(lineNotice(line, productId));
              removeItem(productId, line.variantId);
            }
            continue;
          }
          for (const line of items) {
            if (line.productId !== productId) continue;
            const quote = quoteLineFromProduct(live, line);
            if (quote.status === "unavailable") {
              dropped.push(lineNotice(line, productId));
              removeItem(productId, line.variantId);
              continue;
            }
            const snapshotPrice = line.salePriceLYD ?? line.priceLYD;
            if (roundToCents(quote.effectiveUnitPrice) !== roundToCents(snapshotPrice)) {
              reconcileLine(
                productId,
                {
                  priceLYD: quote.priceLYD,
                  salePriceLYD: quote.salePriceLYD,
                  discountPercent: quote.discountPercent,
                },
                line.variantId,
              );
              anyPriceChanged = true;
            }
          }
        }
        // Shown ONCE for the whole re-quote (subtle status, not an error —
        // the totals next to it already carry the new numbers).
        if (anyPriceChanged) setPricesUpdatedNotice("تم تحديث الأسعار حسب الأسعار الحالية");
        if (dropped.length > 0) setDroppedLineNotices(dropped);
      } finally {
        setPricingRecheckInFlight(false);
      }
    })().catch(() => {
      // Fail-open, silently: the snapshot stands and the CTA unlocks
      // (the flag was already cleared by the finally block).
    });
    // removeItem/reconcileLine are useCallback-stable (deps []) — the
    // effect re-runs only for real cart changes, and early-returns
    // while every product id is already quoted.
  }, [token, isLoaded, items, removeItem, reconcileLine]);

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
      const result = await validateCouponForLines(code, lines, token);
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

  const canSubmit = useMemo(() => {
    if (!token || isEmpty || submitting) return false;
    if (insufficient) return false;
    // 98-F2 (R98-A3 F5): the live re-quote must land before the CTA
    // unlocks — otherwise the first seconds of the page still sell the
    // (possibly stale) snapshot total. customFetch's 20 s abort bounds
    // the wait; a failed re-quote FAILS OPEN (the flag still clears).
    if (pricingRecheckInFlight) return false;
    return true;
  }, [token, isEmpty, submitting, insufficient, pricingRecheckInFlight]);

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
    // R115-I1 (A7 P3-5): the honest denominator for «جارٍ المعالجة… N/M»
    // — the SAME clamp the loop below charges (MAX_UNITS_PER_LINE).
    setSubmitProgress({
      current: 0,
      total: items.reduce((sum, it) => sum + Math.min(it.quantity, MAX_UNITS_PER_LINE), 0),
    });
    // AUD103-2-F1 (r103): sweep inert pre-r103 slot entries (hygiene,
    // off the money path).
    purgeLegacyCheckoutUnitKeys();
    const created: Order[] = [];
    let firstOrderCode: string | null = null;
    let failureMessage: string | null = null;
    let couponFailure = false;
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
          const result = await validateCouponForLines(couponCode, couponQuoteLines(items), token);
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
            failureMessage = apiErrorData(e)?.error || getErrorMessage(e) || "فشل في إنشاء الطلب";
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
        const line = items.find(
          (i) => i.productId === productId && (i.variantId ?? null) === variantId,
        );
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
      }

      if (failureMessage && created.length === 0) {
        // Complete failure — persistent in-page banner + toast cue.
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
        navigate("/orders");
      } else {
        // Full success.
        clear();
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
        if (firstOrderCode && !abandonedRef.current) navigate(`/orders/${firstOrderCode}`);
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
      }
      const msg = getErrorMessage(e);
      setOrderError(msg);
      toast({ title: msg, variant: "destructive" });
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
      <div className="flex items-center gap-3 mb-7 page-in">
        <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
          <ShoppingBag className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold leading-tight">إتمام الطلب</h1>
          <p className="text-sm text-muted-foreground">راجع مشترياتك وأكمل عملية الدفع</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
        {/* Payment details (left on desktop) */}
        <div className="space-y-4">
          {/* Payment method — wallet only (see component docblock) */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-bold text-base">طريقة الدفع</h2>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/50 bg-primary/8 shadow-sm">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-primary/15 text-primary">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-2">
                  خصم من المحفظة
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  رصيدك:{" "}
                  <span className="font-bold text-foreground tabular-nums">
                    {/* 93-C5 / F-15 (A4 #8): a failed probe used to render a
                        fabricated "0.00 د.ل" here (formatBalance(null) →
                        formatCurrency(0)) while the banner below honestly
                        said "تعذّر التحقق من رصيدك" — contradictory money
                        UI. Render an explicit unknown marker instead. */}
                    {balanceLoading ? "…" : balance === null ? "—" : formatBalance(balance)}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-2xs text-muted-foreground mt-3 leading-relaxed">
              سيُخصم ثمن طلباتك من رصيد المحفظة فوراً، وتُسلَّم بيانات الحسابات مباشرة بعد الدفع.
            </p>

            {balanceError && (
              <div
                role="alert"
                className="mt-3 p-3 rounded-xl bg-status-warning/10 border border-status-warning/22 text-status-warning text-xs font-bold flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>
                  تعذّر التحقق من رصيدك. يمكن المتابعة وسيتم التحقق من الرصيد عند إتمام الطلب.
                </span>
              </div>
            )}

            {insufficient && (
              <div
                role="alert"
                className="mt-3 p-3 rounded-xl bg-status-error/10 border border-status-error/22 text-status-error text-xs font-bold flex items-start gap-2"
              >
                <X className="w-4 h-4 shrink-0 mt-px" />
                <div className="flex-1">
                  <p>
                    رصيد المحفظة غير كافٍ (الناقص {formatCurrency(comparisonTotal - (balance ?? 0))}
                    ).
                  </p>
                  <Link
                    href="/wallet?return=/checkout"
                    className="inline-flex items-center gap-1 mt-1.5 text-status-error underline underline-offset-2 hover:opacity-80"
                  >
                    اشحن المحفظة ثم عُد لإتمام الطلب
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Coupon */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-bold text-base">كوبون خصم</h2>
              <span className="text-3xs text-muted-foreground font-bold">(اختياري)</span>
            </div>
            <div className="flex gap-2">
              <Input
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value.toUpperCase());
                  // Any edit voids the stored pre-check result — the label
                  // must never show a total validated for a different code
                  // (the generation bump also kills an in-flight validate
                  // for the OLD code — R98-01's async hole).
                  couponGenerationRef.current += 1;
                  setAppliedCoupon(null);
                  setCouponNotice(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !appliedCoupon) {
                    e.preventDefault();
                    void applyCoupon();
                  }
                }}
                placeholder="أدخل رمز الكوبون"
                aria-label="رمز الكوبون"
                /* 96-F4 (R96 A2 P3-1 / A1 M05): Safari/iOS happily autofills
                   coupon inputs from saved emails, and the shared Input's
                   text-base (16px < md) already prevents the iOS focus-zoom —
                   keep the default size, just opt out of autofill and label
                   the mobile Enter key with its real action (apply). */
                autoComplete="off"
                enterKeyHint="send"
                className="flex-1 font-mono uppercase"
                dir="ltr"
              />
              {appliedCoupon ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearAppliedCoupon}
                  aria-label="إزالة الكوبون"
                  className="shrink-0 font-bold"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void applyCoupon()}
                  disabled={!coupon.trim() || couponChecking || isEmpty}
                  className="shrink-0 font-bold"
                >
                  {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : "تحقق"}
                </Button>
              )}
            </div>
            {couponNotice && !appliedCoupon && (
              <p role="alert" className="text-xs font-bold text-status-error mt-2 leading-relaxed">
                {couponNotice}
              </p>
            )}
            {appliedCoupon && (
              <p
                role="status"
                className="text-xs font-bold text-status-success mt-2 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span dir="ltr" className="font-mono">
                  {appliedCoupon.code}
                </span>
                — خصم {formatCurrency(appliedCoupon.discount_amount)}
              </p>
            )}
            <p className="text-2xs text-muted-foreground mt-2 leading-relaxed">
              يُتحقَّق من الكوبون ويُطبَّق على المنتجات المؤهلة عند إتمام الطلب.
            </p>
          </div>

          {/* Trust */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-bold px-1">
            <ShieldCheck className="w-4 h-4 text-status-success" />
            <span>دفعتك آمنة ومشفّرة بالكامل</span>
          </div>
        </div>

        {/* Cart summary (right on desktop) */}
        <aside className="md:sticky md:top-20 md:self-start">
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <h2 className="font-bold text-base mb-4">ملخص الطلب</h2>

            {/* 98-F2 (R98-A3 F5 / P2): live-price reconciliation
                notices — shown ONCE after the mount re-quote. Dropped
                lines (product/variant no longer sellable) are a
                warning-level alert; a price update is a subtle status
                line (the totals right below already carry the new
                numbers, so this explains WHY they moved).
                Hoisted ABOVE the isEmpty branch on purpose: a drop that
                empties the WHOLE cart (the single-line case) must still
                explain why — inside the old non-empty-only branch the
                notice unmounted the moment the last line left, and the
                shopper just watched their cart silently vanish. */}
            {droppedLineNotices.length > 0 && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-status-warning/10 border border-status-warning/22 text-status-warning text-xs font-bold flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <div className="flex-1 leading-relaxed space-y-1">
                  {droppedLineNotices.map((notice) => (
                    <p key={notice}>{notice}</p>
                  ))}
                </div>
              </div>
            )}
            {pricesUpdatedNotice && (
              <div
                role="status"
                className="mb-4 p-3 rounded-xl bg-status-info/10 border border-status-info/22 text-status-info text-xs font-bold flex items-start gap-2"
              >
                <Tag className="w-4 h-4 shrink-0 mt-px" />
                <span>{pricesUpdatedNotice}</span>
              </div>
            )}

            {isEmpty ? (
              <div className="text-center py-8 text-muted-foreground">
                <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-bold mb-3">سلتك فارغة</p>
                <Link href="/">
                  <Button variant="outline" size="sm" className="font-bold">
                    تصفح المنتجات
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <ul className="space-y-2 mb-4 max-h-72 overflow-y-auto">
                  {items.map((it) => {
                    const price = it.salePriceLYD ?? it.priceLYD;
                    // 98-F2 (F1): with a coupon applied the backend charges
                    // each unit its POST-coupon final — show that number per
                    // line, not the pre-coupon price (the Σ row below then
                    // reads as the sum of exactly these lines).
                    const lineKey = `${it.productId}:${it.variantId ?? 0}`;
                    const unitFinal = appliedCoupon
                      ? appliedCoupon.lineUnitFinals[lineKey]
                      : undefined;
                    const displayUnit = unitFinal ?? price;
                    const displayTotal =
                      unitFinal != null ? unitFinal * it.quantity : price * it.quantity;
                    return (
                      <li
                        key={`${it.productId}:${it.variantId ?? 0}`}
                        className="flex items-center gap-2.5 text-sm"
                      >
                        <div className="w-9 h-9 rounded-lg bg-muted/60 border border-border/40 shrink-0 overflow-hidden flex items-center justify-center">
                          {it.imageUrl ? (
                            <img
                              src={it.imageUrl}
                              alt={it.name}
                              loading="lazy"
                              className="w-full h-full object-contain p-1"
                            />
                          ) : (
                            <span className="text-xs font-bold text-primary/50 select-none">
                              {(it.name ?? "?")[0]}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate">{it.name}</div>
                          {it.variantLabel && (
                            <div className="text-3xs font-semibold text-muted-foreground/85 truncate">
                              {it.variantLabel}
                            </div>
                          )}
                          <div className="text-2xs text-muted-foreground">
                            {it.quantity} × {formatCurrency(displayUnit)}
                          </div>
                        </div>
                        <div className="font-bold tabular-nums text-sm shrink-0">
                          {formatCurrency(displayTotal)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-border/50 pt-3 space-y-1.5 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">المجموع الفرعي</span>
                    <span className="font-bold tabular-nums">{formatCurrency(totalLYD)}</span>
                  </div>
                  {appliedCoupon && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">خصم الكوبون</span>
                      <span className="font-bold tabular-nums text-status-success">
                        −{formatCurrency(appliedCoupon.discount_amount)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-base font-bold pt-1">
                    <span>{appliedCoupon ? "الإجمالي بعد الكوبون" : "الإجمالي"}</span>
                    <span className="tabular-nums text-primary-text">
                      {formatCurrency(comparisonTotal)}
                    </span>
                  </div>
                </div>

                {/* Persistent money-failure banner: an error here must be
                    actionable, not a 4-second toast. */}
                {orderError && (
                  <div
                    role="alert"
                    className="mb-4 p-3.5 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-xs font-bold flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                    <div className="flex-1 leading-relaxed">
                      {partialCount > 0 ? (
                        <>
                          <p>
                            تم إنشاء{" "}
                            {formatCount(partialCount, {
                              one: "طلب",
                              two: "طلبين",
                              few: "طلبات",
                              many: "طلباً",
                              other: "طلب",
                            })}{" "}
                            بنجاح قبل توقف العملية.
                          </p>
                          <p className="mt-1 font-normal">{orderError}</p>
                          <Link
                            href="/orders"
                            className="inline-flex items-center gap-1 mt-1.5 text-status-error underline underline-offset-2 hover:opacity-80"
                          >
                            راجع طلباتك المنشأة
                          </Link>
                        </>
                      ) : (
                        <>
                          <p>تعذّر إتمام الطلب: {orderError}</p>
                          <p className="mt-1 font-normal text-muted-foreground">
                            لم يتم خصم أي مبلغ. راجع الرصيد والمخزون ثم أعد المحاولة.
                          </p>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOrderError(null)}
                      aria-label="إغلاق رسالة الخطأ"
                      /* 96-F4 (R96 A2 P2-12): 44×44 touch target with the
                         negative-margin trick preserved (the banner keeps its
                         tight padding while the hit area grows to the floor). */
                      className="shrink-0 h-11 w-11 -m-2 p-2 rounded-md hover:bg-status-error/10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <Button
                  onClick={handleConfirm}
                  disabled={!canSubmit}
                  /* 96-F4 (R96 A1 M06): the coupon-state label («إتمام الطلب —
                     الإجمالي بعد الكوبون (…)» ≈ 300–330px of Arabic + tabular
                     digits) overflowed the button's inner width at ≤390px because
                     buttonVariants' base ships whitespace-nowrap — the label bled
                     symmetrically outside the rounded CTA on the money screen.
                     whitespace-normal + text-balance override the base (twMerge)
                     so the honest full label wraps gracefully instead, and
                     min-h-12 (was fixed h-12) lets the button grow for 2 lines. */
                  className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold min-h-12 whitespace-normal text-balance leading-snug"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {/* R115-I1 (A7 P3-5): unit progress «جارٍ المعالجة…
                          2/3» for multi-unit baskets (single-unit baskets
                          keep the plain label — 1/1 is noise). */}
                      {submitProgress && submitProgress.total > 1
                        ? `جارٍ المعالجة… ${submitProgress.current}/${submitProgress.total} (${formatCurrency(comparisonTotal)})`
                        : `جارٍ المعالجة… (${formatCurrency(comparisonTotal)})`}
                    </>
                  ) : pricingRecheckInFlight ? (
                    /* 98-F2 (R98-A3 F5): the CTA is disabled while the live
                       re-quote runs — say WHY instead of a dead button. */
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جارٍ تحديث الأسعار…
                    </>
                  ) : appliedCoupon ? (
                    // R111-F2 N1: unified CTA verb — the page title, the
                    // error banner and this button all say «إتمام الطلب»
                    // now (was «تأكيد الطلب», a second verb family on the
                    // money screen).
                    <>إتمام الطلب — الإجمالي بعد الكوبون ({formatCurrency(comparisonTotal)})</>
                  ) : (
                    <>إتمام الطلب ({formatCurrency(totalLYD)})</>
                  )}
                </Button>
                <p className="text-2xs text-muted-foreground text-center mt-3">
                  بالنقر على «إتمام الطلب» فإنك توافق على شروط الاستخدام
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
