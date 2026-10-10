import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { CopyButton } from "@/components/CopyButton";
import { useSeo } from "@/hooks/useSeo";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { buildBreadcrumbLd, buildFaqLd, buildProductLd } from "@/lib/seo-builders";
import { CATEGORY_META } from "@/lib/categories";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility";
import { quietNextScrollToTopReset } from "@/lib/navigation-quiet";
import {
  createOrder,
  customFetch,
  getGetMeQueryKey,
  getGetProductQueryKey,
  getGetProductRecommendationsQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
  getMe,
  getProduct,
  type CreateOrderBody,
  type Product,
  type ProductRecommendation,
  type User,
  useGetMe,
  useGetProduct,
  useGetProductRecommendations,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle,
  ChevronLeft,
  Eye,
  EyeOff,
  Headphones,
  Home,
  Info,
  Loader2,
  Lock,
  Package,
  PlusCircle,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";

// Category-tinted hero gradients on the product page. Ride the shared
// --cat-* tokens (defined in index.css, exposed to Tailwind via @theme)
// so the hero re-tones correctly on the light theme — the previous
// `from-violet-950 via-violet-900/60 to-violet-800/20` style produced
// a near-black slab on light backgrounds because the 800/900/950
// palette is dark-only by design.
const CATEGORY_GRADIENTS: Record<string, string> = {
  streaming: "from-cat-streaming/30 via-cat-streaming/15 to-transparent",
  music: "from-cat-music/30 via-cat-music/15 to-transparent",
  software: "from-cat-software/30 via-cat-software/15 to-transparent",
  vpn: "from-cat-vpn/30 via-cat-vpn/15 to-transparent",
  "ai-tools": "from-cat-ai-tools/30 via-cat-ai-tools/15 to-transparent",
  "seo-tools": "from-cat-seo-tools/30 via-cat-seo-tools/15 to-transparent",
  education: "from-cat-education/30 via-cat-education/15 to-transparent",
  // Retired categories — kept so archived products still render a
  // themed gradient if the operator previews them from admin.
  gaming: "from-cat-gaming/30 via-cat-gaming/15 to-transparent",
  productivity: "from-cat-productivity/30 via-cat-productivity/15 to-transparent",
};

/**
 * Categories that have a dedicated landing page at /category/<slug>.
 * The breadcrumb middle segment links to the category page only when
 * the product's category is in this set; unknown categories fall back
 * to "/" so the breadcrumb never produces a broken link.
 */
const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORY_META));

/** The product's category landing-page meta (label + slug route) when it
 * has one — null for retired/unknown categories so the visible breadcrumb
 * and the back affordance below degrade to the home path instead of a
 * broken /category/<retired> link (the JSON-LD breadcrumb follows the same
 * KNOWN_CATEGORIES rule). */
const categoryMetaFor = (cat: string | null | undefined) =>
  cat && KNOWN_CATEGORIES.has(cat) ? CATEGORY_META[cat as keyof typeof CATEGORY_META] : null;

// Empty-image fallback foreground tint per category. Mirrors the
// gradient palette above so the giant first-letter glyph reads as
// "this is a [category] product" without needing the actual image.
const CATEGORY_INITIAL_COLOR: Record<string, string> = {
  streaming: "text-cat-streaming",
  music: "text-cat-music",
  software: "text-cat-software",
  vpn: "text-cat-vpn",
  "ai-tools": "text-cat-ai-tools",
  "seo-tools": "text-cat-seo-tools",
  education: "text-cat-education",
  // Retired — same rationale as CATEGORY_GRADIENTS above.
  gaming: "text-cat-gaming",
  productivity: "text-cat-productivity",
};

const TRUST_SIGNALS = [
  { icon: Truck, label: "تسليم فوري", desc: "حصل عليه فور الدفع" },
  { icon: ShieldCheck, label: "دفع آمن", desc: "من محفظتك المشحونة" },
  { icon: Headphones, label: "دعم متاح", desc: "تواصل معنا أي وقت" },
];

// ── 97-F5 (R97-A4 §2 / F-02 — money P2): stable single-purchase intent key ──
//
// The buy-intent Idempotency-Key used to live in a useRef — it died with
// the component, so a refresh / back-navigation / PWA cold-resume after
// a NETWORK-level failure (response lost, wallet already charged) minted
// a FRESH key on the re-tap → a second order and a second deduction (the
// exact window 96-F4 closed for checkout, which stores its keys in
// sessionStorage — this page now mirrors that pattern exactly).
//
// Lifecycle (lazy — minted on the intent's first attempt):
//   • read:   a stored key is REUSED verbatim when still valid → the retry
//             of an unresolved intent replays the server's cached response
//             instead of charging again (this is the double-charge fix).
//   • write:  BEFORE the request, under subnation_buykey:{productId},
//             stamped with the mint time + the intent fingerprint
//             (productId × effective price × coupon code).
//   • delete: ONLY at a definitive resolution —
//       - 2xx success (the order was created and shown);
//       - an HTTP-level ApiError rejection (the server definitively
//         refused — a re-tap is a NEW intent and must not be answered
//         forever by the cached rejection).
//     A network-level failure (server state unknown) deliberately KEEPS
//     the stored key — the retry must replay, not re-charge.
//   • staleness guards (F-07's lesson, applied here at birth):
//       - TTL: a key older than 10 minutes no longer represents the
//         user's live intent and is ignored (minted fresh instead) — a
//         stale key must not swallow a NEW purchase hours later via the
//         server's 24 h replay window;
//       - fingerprint: a price/coupon change invalidates the stored key
//         so a stale intent is never replayed onto changed data (and the
//         backend's same-key-different-body 409 branch stays unreachable).
//
// localStorage (durable) rather than sessionStorage (per-tab) — R102
// (R102-A1 F1 / P1, mirroring checkout.tsx): the retry token must
// outlive the tab exactly as long as the user's intent can — a network-
// level loss (server committed, response lost) followed by tab death
// used to mint a FRESH key on the next visit and charge twice. The
// TTL + fingerprint guards minted at birth (97-F5) already make stale
// keys inert, so durability costs nothing. Every access is
// try/catch-guarded: a private-mode / quota failure degrades to the old
// unstable-key behavior and never blocks the money path.
const BUY_KEY_PREFIX = "subnation_buykey:";
/** 97-F5 (F-02): retry-token TTL — mirrors the inspection's 10 min guidance. */
const BUY_KEY_TTL_MS = 10 * 60 * 1000;

interface StoredBuyIntent {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — productId | effective price | coupon code. */
  f: string;
}

function buyIntentKeyId(productId: number): string {
  return `${BUY_KEY_PREFIX}${productId}`;
}

/** Binds the stored key to WHAT the user is buying right now — a replay
 * must only answer the intent it was minted for. */
function buyIntentFingerprint(
  productId: number,
  effectivePrice: number | null | undefined,
  couponCode?: string | null,
  variantId?: number | null,
): string {
  return `${productId}|${effectivePrice ?? ""}|${(couponCode ?? "").trim().toUpperCase()}|${variantId ?? ""}`;
}

/** R115-I1 (A7 P2-2): cent-exact price equality for the pre-buy
 * re-quote — floating-point sums must never turn an unchanged price
 * into a spurious "price changed" abort. */
function toCents(value: number): number {
  return Math.round(value * 100);
}

function loadBuyIntentKey(productId: number, fingerprint: string): string | null {
  try {
    const raw = localStorage.getItem(buyIntentKeyId(productId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredBuyIntent>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    // TTL — a key minted >10 min ago is a stale intent, not this retry.
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > BUY_KEY_TTL_MS) return null;
    // Intent binding — the product's price (or the coupon) changed since
    // the key was minted: replaying it onto the new data would either
    // swallow a genuinely new purchase or trip the 409 body-mismatch.
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    // Corrupted entry / storage failure — degrade to a fresh key.
    return null;
  }
}

function persistBuyIntentKey(productId: number, fingerprint: string, key: string): void {
  try {
    const entry: StoredBuyIntent = { k: key, t: Date.now(), f: fingerprint };
    localStorage.setItem(buyIntentKeyId(productId), JSON.stringify(entry));
  } catch {
    // degraded: unstable keys (pre-fix behavior) — never throw on money path
  }
}

function clearBuyIntentKey(productId: number): void {
  try {
    localStorage.removeItem(buyIntentKeyId(productId));
  } catch {
    // ignore
  }
}

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  /** 93-C5 / F-15 (A4 #11): mask the value until explicitly revealed —
   * ported from order-detail's CopyField (V2-H10) so the paid password
   * isn't shoulder-surfable in the first second after purchase on this
   * screen too. Previously rendered in cleartext here while order-detail
   * masked the exact same credential. */
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        {/* 96-F4 (R96 A6 #1): no uppercase/tracking-wider on Arabic labels —
            letter-spacing tears the cursive joins (ج/ح/خ disconnect). */}
        <div className="text-3xs text-muted-foreground font-bold mb-0.5">{label}</div>
        {/* 96-F4 (R96 A2 P1-5): the credential VALUE lives in a NON-button
            selectable element (select-text + break-all) — the old markup
            trapped it inside the copy <button> (unselectable on iOS) and
            clipped it at max-w-[160px] truncate, leaving zero fallback
            when copy failed. dir="ltr" isolation kept from V2-H10: the
            exact data the user PAID for must read (and copy) correctly. */}
        <div
          dir="ltr"
          className="font-mono font-bold text-sm break-all leading-snug text-left select-text"
        >
          {revealed ? value : "•".repeat(Math.min(value.length, 12))}
        </div>
        {secret && (
          /* 96-F4 (R96 A2 P1-4): reveal is its own 44px control on the
              LABEL side — visually separated from the copy affordance on
              the opposite side (they used to be twin pills; a mis-tap hit
              the neighbor's identical pill). */
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            className="mt-2 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-bold transition-all duration-180 border press-spring bg-muted/40 text-muted-foreground border-border/35 hover:bg-primary/10 hover:text-primary-text hover:border-primary/22"
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {revealed ? "إخفاء" : "إظهار"}
          </button>
        )}
      </div>
      {/* 96-F4 (R96 A2 P1-3): the shared CopyButton (size="md", min-h-11)
          replaces the local reimplementation — copy failure now announces
          itself («تعذّر النسخ») instead of silently keeping the label. */}
      <CopyButton text={value} size="md" />
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { addItem } = useCart();
  const [orderResult, setOrderResult] = useState<any>(null);
  // R115-I1 (A7 P3-8): the buy-success money receipt — the charged amount
  // + the post-charge wallet balance. balanceAfter stays null until the
  // cache:"no-store" /me refresh lands: a STALE pre-purchase balance
  // must never be presented as "remaining" on the success screen.
  const [purchaseSummary, setPurchaseSummary] = useState<{
    charged: number;
    balanceAfter: number | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponValidating, setCouponValidating] = useState(false);
  const [couponResult, setCouponResult] = useState<null | {
    code: string;
    discount_amount: number;
    final_amount: number;
    type: string;
    value: number;
    description: string | null;
  }>(null);
  const [couponError, setCouponError] = useState("");
  // R98-01 (r98 frontend-deep §2 — P1): validation-generation counter.
  // validateCoupon() stamps the generation it started in; the
  // variant-void effect below (and every NEW validation) bumps the
  // counter — a response that lands after its generation was superseded
  // is discarded instead of resurrecting a coupon result computed
  // against a price the user is no longer looking at.
  const couponGenerationRef = useRef(0);

  // ── Slug-or-id routing ─────────────────────────────────────────────
  // The route `/product/:slug` accepts both:
  //   - numeric id (legacy URLs, bookmarks, sitemap entries from before
  //     the slug migration ran — fetched by id, then transparently
  //     redirected to the canonical slug URL for SEO)
  //   - URL-safe slug (post-migration canonical form)
  //
  // We detect "numeric" with a strict regex: `/^\d+$/` rather than
  // `parseInt`, because parseInt("12-foo") = 12 which would mismatch
  // a slug that happens to start with digits ("12-month-plan").
  const param = slug ?? "";
  const isLegacyNumeric = /^\d+$/.test(param);
  const numericId = isLegacyNumeric ? parseInt(param, 10) : 0;

  // Path 1: numeric id (legacy). Use the typed orval client.
  const byIdQuery = useGetProduct(numericId, {
    query: {
      queryKey: getGetProductQueryKey(numericId),
      enabled: isLegacyNumeric && numericId > 0,
    },
  });

  // Path 2: slug (canonical). R116-S2 (P3): rides customFetch now —
  // the repo client's 20 s abort + cold-boot 503 retry + ApiError
  // shape (the raw fetch threw bare Errors, so a slug-path 404/outage
  // was a different error class than the by-id path for no reason).
  // The response shape is byte-for-byte identical to the by-id
  // response, so the rest of this page's render code is fully
  // shape-agnostic.
  const bySlugQuery = useQuery({
    queryKey: ["product-by-slug", param],
    enabled: !isLegacyNumeric && !!param,
    queryFn: () =>
      customFetch<Product & { slug?: string | null }>(
        `/api/products/by-slug/${encodeURIComponent(param)}`,
        { responseType: "json", headers: { Accept: "application/json" } },
      ),
    retry: false,
  });

  const product = (isLegacyNumeric ? byIdQuery.data : bySlugQuery.data) as
    (typeof byIdQuery.data & { slug?: string | null }) | undefined;
  const isLoading = isLegacyNumeric ? byIdQuery.isLoading : bySlugQuery.isLoading;
  const isError = isLegacyNumeric ? byIdQuery.isError : bySlugQuery.isError;
  const refetchProduct = isLegacyNumeric ? byIdQuery.refetch : bySlugQuery.refetch;
  // A 404 is a genuine "product not found"; any other error is an
  // outage/connection failure that deserves its own state (below).
  const fetchError = isLegacyNumeric ? byIdQuery.error : bySlugQuery.error;
  const isNotFoundError = isError && (fetchError as { status?: number } | null)?.status === 404;

  // After a numeric-id fetch resolves and the product carries a slug,
  // rewrite the URL to the canonical slug form via history.replaceState.
  // We DON'T navigate via wouter — that would unmount the component
  // and refetch. replaceState updates the bar without a route change.
  useEffect(() => {
    if (!isLegacyNumeric) return;
    const productSlug = (byIdQuery.data as { slug?: string | null } | undefined)?.slug;
    if (productSlug && typeof window !== "undefined") {
      const next = `/product/${productSlug}`;
      // R117 (F-4): wouter 3.9 patches replaceState into a location
      // change, so this rewrite re-fired ScrollToTop (scroll-to-top +
      // #main-content.focus()) while the user was mid-read. Arm the
      // one-shot suppression ONLY when the path actually changes — a
      // same-URL replaceState emits nothing and an armed-but-unconsumed
      // flag would wrongly swallow the next real navigation's reset.
      if (window.location.pathname !== next) {
        quietNextScrollToTopReset();
        window.history.replaceState(null, "", next);
      }
    }
  }, [isLegacyNumeric, byIdQuery.data]);

  const { data: user, isLoading: userLoading } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  // 96-F4 (R96 A4 §2.3 — money P1) + 97-F5 (R97-A4 §2 / F-02): one
  // Idempotency-Key per buy-intent, stable across refresh / back-nav /
  // PWA resume via sessionStorage (see the helpers' docblock above for
  // the full lifecycle: TTL + price/coupon fingerprint + terminal-only
  // deletion). Sent via createOrder's second argument — the exact shape
  // checkout.tsx's per-unit loop uses.
  const [buyPending, setBuyPending] = useState(false);

  // R116-S2 (P2): hide the sticky mobile buy bar while the virtual
  // keyboard is open (visualViewport pattern — see
  // hooks/use-keyboard-visibility.ts; the paired CSS fallback rides the
  // bar itself). Called before ANY early return, per the rules of hooks.
  const stickyBarHiddenByKeyboard = useKeyboardVisibility();

  // ── Catalog variants (2026-09-20) ──────────────────────────────────
  // The product's sellable options arrive on the /api/products DTO as
  // `variants` (labels + LYD price only). The selector defaults to the
  // CHEAPEST option — the same rule the checkout + product cards use —
  // so the displayed price is always the chargeable price.
  const productVariants = (
    product as
      | {
          variants?: {
            id: number;
            plan_label?: string | null;
            duration_label?: string | null;
            label: string;
            price: number;
            sale_price?: number | null;
            discount_percent?: number | null;
            is_available: boolean;
          }[];
        }
      | undefined
  )?.variants;
  const sortedVariants = useMemo(
    () => (productVariants ? [...productVariants].sort((a, b) => a.price - b.price) : []),
    [productVariants],
  );
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  // Keep the selection valid across refetches (a selected option may have
  // been deactivated or removed): fall back to the cheapest active one.
  const selectedVariant = useMemo(() => {
    if (sortedVariants.length === 0) return null;
    const chosen =
      (selectedVariantId != null
        ? sortedVariants.find((v) => v.id === selectedVariantId)
        : undefined) ??
      sortedVariants.find((v) => v.is_available) ??
      sortedVariants[0];
    return chosen;
  }, [sortedVariants, selectedVariantId]);

  // Reset the explicit selection whenever the product changes (slug/id
  // navigation reuses this component without unmounting).
  useEffect(() => {
    setSelectedVariantId(null);
  }, [product?.id]);

  // R98-01 (r98 frontend-deep §2 / R98-A3 §9 — P1): the validated coupon
  // result is voided whenever the EFFECTIVE selected variant changes —
  // mirroring checkout.tsx's [items] void for the same defect class.
  // validateCoupon() computes its math against the selected variant's
  // base price; without this reset a shopper who validated on a 50 د.ل
  // option and then switched to a 100 د.ل option kept seeing the stale
  // «final_amount» (زر «شراء الآن (40.00)» يعرض مبلغًا لن يُحصَّد — the
  // server re-computes the coupon against the NEW variant's price and
  // charges 90). Keyed on selectedVariant?.id (not the raw state) so a
  // FALLBACK selection change (cheapest option removed/added on
  // refetch, product navigation) voids too. couponInput is kept so
  // re-validating on the new variant is one tap on «تحقق».
  useEffect(() => {
    couponGenerationRef.current += 1;
    setCouponResult(null);
    setCouponError("");
  }, [selectedVariant?.id]);

  const handleBuyIntent = async () => {
    if (!product || buyPending) return;
    setBuyPending(true);
    setError("");
    try {
      // ── R115-I1 (A7 P2-2): live pre-buy re-quote ──────────────────────
      // The page's price snapshot can be arbitrarily old (staleTime 60 s
      // + refetchOnWindowFocus disabled): a flash sale that ended (or
      // started) between page-open and the buy tap had the shopper
      // approve one number while the server charged the live one — the
      // exact defect class checkout's 98-F2 mount re-quote closed for
      // the cart; the single-buy path now re-quotes right before the
      // charge. Contract (mirrors 98-F2):
      //   • fetch failure → FAIL-OPEN: proceed with the displayed price
      //     (the server stays the charge authority and re-prices the
      //     order anyway);
      //   • live effective price ≠ displayed (or the selected option
      //     no longer exists) → ABORT before any key is minted or any
      //     charge is attempted, refresh the page's product data, void
      //     the coupon (its math was computed against the stale base)
      //     and tell the shopper honestly.
      const quotedVariantId = selectedVariant?.id ?? null;
      const quotedBasePrice = selectedVariant
        ? (selectedVariant.sale_price ?? selectedVariant.price)
        : (product.sale_price ?? product.price);
      try {
        const live = await getProduct(product.id);
        const liveVariant =
          quotedVariantId != null
            ? (live.variants ?? []).find((v) => v.id === quotedVariantId)
            : undefined;
        const livePrice =
          quotedVariantId != null
            ? liveVariant
              ? (liveVariant.sale_price ?? liveVariant.price)
              : null
            : (live.sale_price ?? live.price);
        if (livePrice == null || toCents(livePrice) !== toCents(quotedBasePrice)) {
          // Abort — no intent key was minted yet (the fingerprint below
          // never ran), so the next tap on the refreshed numbers is a
          // genuinely new intent by construction.
          try {
            void refetchProduct();
          } catch {
            // best-effort UI refresh — the toast still explains the abort
          }
          couponGenerationRef.current += 1;
          setCouponResult(null);
          setCouponError("");
          toast({
            title: "تحديث السعر",
            description: "تغيّر السعر منذ فتحت الصفحة — عُرض السعر المحدّث، راجعه ثم أعد الشراء.",
          });
          return;
        }
      } catch {
        // Fail-open (98-F2 contract): the displayed price stands; the
        // server re-prices the order on its side regardless.
      }
      const body: CreateOrderBody = { product_id: product.id };
      if (selectedVariant) body.variant_id = selectedVariant.id;
      if (couponResult?.code) body.coupon_code = couponResult.code;
      // 97-F5 (F-02): mint-or-reuse the intent key BEFORE the request — a
      // stored key still inside its TTL and matching the current price /
      // coupon fingerprint is replayed verbatim (network-failure retry →
      // server replay instead of a second charge). The variant id rides
      // the fingerprint so switching options mints a fresh intent.
      const fingerprint = buyIntentFingerprint(
        product.id,
        quotedBasePrice,
        couponResult?.code,
        selectedVariant?.id ?? undefined,
      );
      const intentKey = loadBuyIntentKey(product.id, fingerprint) ?? generateIdempotencyKey();
      persistBuyIntentKey(product.id, fingerprint, intentKey);
      const order = await createOrder(body, {
        headers: { "Idempotency-Key": intentKey },
      });
      // Success — the intent is terminally resolved; the next buy mints
      // a fresh key (and nothing stale can swallow it later).
      clearBuyIntentKey(product.id);
      // R115-I1 (A7 P3-8): seed the success screen's money receipt. The
      // charged amount prefers the server's own figure (order.amount);
      // the theoretical fallback (displayed base, or the coupon final
      // when one is applied) is only for degenerate/legacy payloads.
      const chargedAmount =
        typeof order?.amount === "number"
          ? order.amount
          : couponResult
            ? couponResult.final_amount
            : quotedBasePrice;
      setPurchaseSummary({ charged: chargedAmount, balanceAfter: null });
      setOrderResult(order);
      // 93-C5 / sim P2 (navbar balance staleness): a plain invalidate of
      // /api/auth/me can be answered from the browser HTTP cache
      // (Cache-Control: private, max-age=30) with the pre-purchase body,
      // leaving the Navbar's balance chip stale. Fetch me with
      // cache:"no-store" and seed the query cache directly (no refetch
      // race); fall back to a plain invalidation if the refresh fails.
      // (checkout.tsx runs the identical refresh after its unit loop.)
      void (async () => {
        try {
          const freshUser = await getMe({ cache: "no-store" });
          queryClient.setQueryData(getGetMeQueryKey(), freshUser);
          // R115-I1 (A7 P3-8): the fresh post-charge balance completes the
          // success screen's receipt («رصيدك المتبقي») — only the
          // no-store response may populate it (never the stale cache).
          if (typeof freshUser?.wallet_balance === "number") {
            setPurchaseSummary({ charged: chargedAmount, balanceAfter: freshUser.wallet_balance });
          }
        } catch {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        }
      })();
      // 93-C5 (A4 #20): the purchase must appear in the orders list
      // (home's "آخر الطلبات" strip, /orders) immediately — not ≤60 s
      // later. No-arg form invalidates every list param variant.
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      // 97-F5 (R97-A4 §3 / F-06 — P2): /api/wallet is a SEPARATE data
      // point from me.wallet_balance — /wallet renders wallet.balance,
      // and with staleTime 60 s + refetchOnWindowFocus disabled a
      // still-fresh pre-purchase entry showed the OLD balance right
      // after the charge (the navbar chip contradicted the wallet
      // page). checkout.tsx already invalidates this key after its
      // unit loop; the single-purchase path now mirrors it.
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err: unknown) {
      // Definitive HTTP rejection → the intent is resolved; clear the
      // stored key. Network-level failure keeps it for the retry's replay.
      // 99-M2 (R99-A2 P1 — money): 409 IDEMPOTENCY_IN_FLIGHT is NOT
      // definitive — the same-key request is still executing server-side
      // (this attempt merely raced it). Keeping the stored key makes the
      // retry replay the intent instead of minting a fresh key that would
      // DOUBLE-CHARGE once the in-flight request commits. The backend's
      // Arabic message explicitly tells the user to retry — this guard
      // makes that retry safe.
      const httpCode =
        err instanceof Error && err.name === "ApiError"
          ? ((err as { data?: { code?: string } }).data?.code ?? null)
          : null;
      if (err instanceof Error && err.name === "ApiError" && httpCode !== "IDEMPOTENCY_IN_FLIGHT") {
        clearBuyIntentKey(product.id);
      }
      setError(getErrorMessage(err));
    } finally {
      setBuyPending(false);
    }
  };

  const validateCoupon = async () => {
    if (!couponInput.trim() || !product) return;
    setCouponValidating(true);
    setCouponError("");
    setCouponResult(null);
    // R98-01: claim this validation's generation — a variant switch (or a
    // newer validation) while the request is in flight supersedes it.
    const generation = ++couponGenerationRef.current;
    try {
      // Coupon math applies to the SELECTED variant's price (the charge
      // the server will actually compute at checkout).
      const basePrice = selectedVariant
        ? (selectedVariant.sale_price ?? selectedVariant.price)
        : (product.sale_price ?? product.price);
      const r = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: couponInput.trim().toUpperCase(), order_amount: basePrice }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // R98-01: the variant changed under the in-flight request — the
      // response describes a price the user is no longer buying. Drop
      // it; the void effect already reset the chip/error state.
      if (generation !== couponGenerationRef.current) return;
      setCouponResult(data);
    } catch (err: unknown) {
      if (generation !== couponGenerationRef.current) return;
      // Persist the error inline (visible until the user types a new
      // code) AND fire a toast for the immediate "something happened"
      // cue. Inline-only would be invisible if the user looked away;
      // toast-only would disappear in 4s before the user could read it.
      const message =
        err instanceof Error ? err.message : "تعذّر التحقق من الكوبون — حاول مرة أخرى";
      setCouponError(message);
      toast({
        title: "تعذّر تطبيق الكوبون",
        description: message,
        variant: "destructive",
      });
    } finally {
      // Always clear the in-flight flag: the only superseder is the
      // variant-void effect (the validate button is disabled while a
      // request is in flight, so no second validation can race this
      // finally) — a superseded response must not leave the spinner on.
      setCouponValidating(false);
    }
  };

  const clearCoupon = () => {
    setCouponInput("");
    setCouponResult(null);
    setCouponError("");
  };

  // Add current product (at its effective post-coupon price context is
  // revalidated at checkout) to the local cart — the multi-item funnel.
  // 96-F4 (R96 A2 P1-7): 500ms re-entry lock — a double-tap on a laggy
  // phone used to add qty 2 in one gesture (and the funnel charged twice
  // at checkout); the toast already confirms the first add, so the second
  // tap inside the lock window is safely swallowed.
  const lastAddTapRef = useRef(0);
  const handleAddToCart = () => {
    if (!product) return;
    const now = Date.now();
    if (now - lastAddTapRef.current < 500) return;
    lastAddTapRef.current = now;
    // Variant-aware line: the selected option's price + label ride the
    // cart line so checkout charges exactly what the product page showed.
    addItem({
      productId: product.id,
      variantId: selectedVariant ? selectedVariant.id : null,
      variantLabel: selectedVariant ? selectedVariant.label : null,
      slug: product.slug ?? null,
      name: product.name ?? "",
      imageUrl: product.image_url ?? null,
      priceLYD: selectedVariant ? selectedVariant.price : product.price,
      salePriceLYD: selectedVariant
        ? (selectedVariant.sale_price ?? null)
        : (product.sale_price ?? null),
      discountPercent: selectedVariant
        ? (selectedVariant.discount_percent ?? null)
        : (product.discount_percent ?? null),
    });
    toast({
      title: "أُضيف إلى السلة",
      description: selectedVariant
        ? `${product.name} — ${selectedVariant.label}`
        : (product.name ?? undefined),
    });
  };

  // SEO — called unconditionally (before the loading/not-found early
  // returns below) so hook order is stable across renders (rules-of-hooks).
  // Falls back to neutral metadata while the product is still loading.
  // Catalog-2026-09-20: operator-provided seo_title / seo_description
  // overrides (from the import) take precedence; the fallback stays
  // price-aware off the selected variant.
  const seoPrice = selectedVariant
    ? (selectedVariant.sale_price ?? selectedVariant.price)
    : product
      ? (product.sale_price ?? product.price)
      : 0;
  // Only emit FAQPage JSON-LD when there's a non-empty curated FAQ list
  // on the product. Empty arrays are treated by Google as a thin
  // structured-data block.
  // 98-F9: every field below (description_long, faq, seo_title,
  // seo_description, features) now lives in the generated Product
  // contract — the spec gap (features missing) that forced this local
  // `any`-shaped cast is closed; plain property access on the typed
  // query data. Name kept to minimize the diff.
  const productAny = product;
  const productFaqs =
    Array.isArray(productAny?.faq) && productAny!.faq!.length > 0 ? productAny!.faq! : null;
  const seoBlock = useSeo(
    product
      ? {
          title: productAny?.seo_title?.trim()
            ? productAny.seo_title
            : `${product.name} — ${formatCurrency(seoPrice)}`,
          description: (
            productAny?.seo_description?.trim() ||
            product.description ||
            `${product.name} متوفر بالدينار الليبي على SubNation. تسليم فوري بعد الدفع.`
          ).slice(0, 160),
          image: product.image_url ?? undefined,
          type: "product",
          path: `/product/${product.slug ?? product.id}`,
          locale: "ar",
          jsonLd: [
            buildProductLd({
              id: product.id,
              slug: product.slug,
              name: product.name,
              description: product.description,
              descriptionLong: productAny?.description_long ?? null,
              imageUrl: product.image_url,
              price: seoPrice,
              category: product.category,
              isActive: product.is_active ?? true,
              // D2-F2 (R111): thread the REAL stock signal — the same
              // is_available the buy button gates on — so the Offer LD
              // asserts OutOfStock when the UI says «نفد المخزون».
              isAvailable: product.is_available,
            }),
            buildBreadcrumbLd([
              { name: "الرئيسية", href: "/" },
              {
                name: categoryLabel(product.category ?? "") || "المنتجات",
                href:
                  product.category && KNOWN_CATEGORIES.has(product.category)
                    ? `/category/${product.category}`
                    : "/",
              },
              { name: product.name, href: `/product/${product.slug ?? product.id}` },
            ]),
            ...(productFaqs ? [buildFaqLd(productFaqs)] : []),
          ],
        }
      : isNotFoundError
        ? {
            /* R124 (A10-F1 P2): a 404 is definitive — the infinite
               /product/<anything> URL space must never consolidate
               against the homepage (Google flags homepage-canonicalized
               soft-404s; category.tsx's unknown-slug branch is the
               in-house pattern). noindex,follow + a SELF canonical: the
               phantom URL consolidates nowhere, and MetaTags' upsert
               keeps og:url honest for WhatsApp unfurls of dead product
               links. The block is rendered by the !product early return
               below (category.tsx A7-F1 pattern — an unrendered useSeo
               element owns nothing and the App fallback would win);
               the LOADING skeleton and the outage card deliberately
               render NO block, keeping the App fallback's index,follow
               + self canonical there (an outage on a REAL product URL
               must not deindex or re-canonicalize it). The neutral
               third branch below only covers the defensive null-data-
               without-error edge. */
            title: "المنتج غير موجود — SubNation",
            description:
              "المنتج المطلوب غير موجود أو لم يعد متوفراً. تصفّح باقي الاشتراكات الرقمية بالدينار الليبي من الصفحة الرئيسية.",
            path: `/product/${param}`,
            locale: "ar",
            robots: "noindex,follow",
          }
        : {
            title: "SubNation",
            description: "اشتراكات رقمية بالدينار الليبي.",
            path: "/",
            locale: "ar",
          },
  );

  // ── Loading skeleton ──────────────────────────────────────────────────────
  // R123-E4b (CLS, live-measured 0.21 on the OOS product page): the old
  // in-page skeleton was a max-w-xl single-column stack while the real
  // page is max-w-xl lg:max-w-6xl with the R116-S2 desktop split — the
  // data-arrival swap made the container jump 576px→1152px wide at
  // ≥1024px (0.176 layout-shift entry). Rendering the SAME "product"
  // shape the route-level Suspense fallback uses kills both the
  // chunk-skeleton→page-skeleton drift and the skeleton→content width
  // jump (the shape mirrors the two-column split + recommendations rail
  // + mobile sticky-bar slot — see route-skeleton.tsx ProductShell).
  if (isLoading) return <RouteSkeleton shape="product" />;

  if (isError && !isLoading && !isNotFoundError)
    /* Distinguish a network/server failure from a real 404 — both used to
       render "المنتج غير موجود", which hides outages from shoppers. */
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
        <div className="w-16 h-16 rounded-2xl bg-status-error/8 border border-status-error/22 mx-auto mb-4 flex items-center justify-center">
          <Package className="w-7 h-7 text-status-error/70" />
        </div>
        <p className="font-bold mb-1 text-foreground/80">تعذّر تحميل المنتج</p>
        <p className="text-sm mb-3">حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة</p>
        <div className="flex items-center justify-center gap-2.5">
          {/* R125-I7 (A7 B-4): both recovery buttons ride the 44px tap
              floor (min-h-11) — the drifted px-5 py-2 measured ~37px.
              The two-button row (retry + escape hatch) stays bespoke
              per the R124-I8 extraction ledger. */}
          <button
            onClick={() => refetchProduct()}
            className="min-h-11 text-sm font-bold text-primary-text border border-primary/25 px-5 rounded-xl hover:bg-primary/8 transition-colors press-spring"
          >
            إعادة المحاولة
          </button>
          <button
            onClick={() => navigate("/")}
            className="min-h-11 text-sm text-muted-foreground hover:text-foreground border border-border/50 px-5 rounded-xl transition-colors press-spring"
          >
            العودة للكتالوج
          </button>
        </div>
      </div>
    );

  if (!product)
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
        {/* A7-F1 (category.tsx pattern): the not-found SEO block renders
            HERE too — this early return is the only place the 404 branch's
            noindex,follow + self canonical can own the head. Without this
            render the useSeo element never mounts, the App-level fallback
            (index,follow) wins, and the R124 A10-F1 fix is inert. */}
        {seoBlock}
        {/* R128-A2 (F-2): converged on the generic 404's recipe
            (not-found.tsx) — real h1, muted copy, size="lg" Button pair,
            quick links. The retired branch (p.font-bold + a 14px
            underline recovery link) shipped the HIGHER-traffic 404
            (delisted products, dead share links) below the app's own
            404 craft bar: no heading element, a sub-44px recovery CTA. */}
        <div className="max-w-sm mx-auto space-y-8">
          <div>
            <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
              <Package className="w-7 h-7 opacity-40" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-3">المنتج غير موجود</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              يبدو أن هذا المنتج لم يعد متوفراً أو أن الرابط غير صحيح.
            </p>
          </div>
          {/* Actions — the R116-S1 CTA recipe (not-found.tsx): primary
              rides the canonical Button (size lg, w-full sm:w-auto);
              secondary rides the system secondary variant. */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="w-full sm:w-auto">
              {/* Home IS the catalog (App.tsx routing) — same destination
                  the old recovery link carried. */}
              <Link href="/">
                <Home className="w-4 h-4" />
                العودة للكتالوج
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => window.history.back()}
              className="w-full sm:w-auto"
            >
              {/* RTL: "back" points right (not-found.tsx idiom) */}
              <ArrowRight className="w-4 h-4" />
              رجوع
            </Button>
          </div>
          {/* Quick links — the not-found.tsx band (min-h-11 chips). */}
          <div className="pt-2 border-t border-border/40">
            <p className="text-2xs font-bold text-muted-foreground mb-3">روابط سريعة</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                { href: "/", label: "المتجر" },
                { href: "/wallet", label: "المحفظة" },
                { href: "/orders", label: "طلباتي" },
                { href: "/support", label: "الدعم" },
              ].map((l) => (
                <Link key={l.href} href={l.href}>
                  <span className="inline-flex items-center min-h-11 text-xs text-muted-foreground hover:text-foreground px-3 rounded-lg border border-border/50 hover:border-border bg-secondary/30 hover:bg-secondary/60 transition-all cursor-pointer">
                    {l.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    );

  // Variant-aware display price — the SELECTED option's price (or the
  // product-level price for variant-less products). This is the number
  // the CTA block, coupon math, and buy-intent all key off — one source.
  const displayPrice = selectedVariant
    ? (selectedVariant.sale_price ?? selectedVariant.price)
    : (product.sale_price ?? product.price);
  const gradientClass =
    CATEGORY_GRADIENTS[product.category ?? "streaming"] ??
    "from-primary/20 via-primary/8 to-transparent";
  const initialColorClass = CATEGORY_INITIAL_COLOR[product.category ?? ""] ?? "text-white/30";

  // R94-A1 #7 (P2): both CTA surfaces (desktop block + mobile sticky bar)
  // must carry the SAME buy-intent (?intent=buy&product=) and wallet-return
  // (?return=) params. The sticky bar used to navigate to bare /login and
  // /wallet — for the mobile majority (Libya) that meant a cold login
  // prompt with no product context, and no return-to-product after a
  // top-up: the desktop-only funnel, broken on mobile.
  //
  // 96-F4 (R96 A4 §2.4): the intent navigation now also appends
  // &redirect=/product/<slug> — login.tsx honors ONLY ?redirect= on
  // success, so the intent flow used to land the freshly-signed-in buyer
  // on home while the banner had just promised «سجّل دخولك لإكمال شراء «X»».
  // The ?intent= mechanism keeps working (the banner still reads it); the
  // redirect param simply threads the product context through sign-in.
  const loginWithIntent = () =>
    navigate(
      `/login?intent=buy&product=${encodeURIComponent(product.name).slice(0, 200)}&redirect=${encodeURIComponent(`/product/${product.slug ?? product.id}`)}`,
    );
  const walletWithReturn = () =>
    navigate(`/wallet?return=${encodeURIComponent(`/product/${product.slug ?? product.id}`)}`);

  // ── Order success ─────────────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
        <div
          role="status"
          aria-live="polite"
          className="bg-card border border-status-success/22 rounded-2xl overflow-hidden float-in"
        >
          {/* Success header */}
          <div className="p-6 text-center border-b border-border/40 bg-gradient-to-b from-status-success/8 to-transparent">
            {/* Animated ring */}
            <div className="relative w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full bg-status-success/15 success-ring" />
              <div className="absolute inset-0 rounded-full bg-status-success/8" />
              <div className="w-full h-full bg-status-success/15 rounded-full flex items-center justify-center ring-4 ring-status-success/12">
                <CheckCircle className="w-9 h-9 text-status-success" />
              </div>
            </div>
            <h1 className="text-xl font-bold mb-1.5">تم الشراء بنجاح!</h1>
            <p className="text-muted-foreground text-sm flex items-center justify-center gap-1.5 flex-wrap">
              رقم الطلب:
              {/* R116-S2 (P3): the shared CopyButton owns the
                  idle → copied → failed lifecycle (the old local
                  copyField helper + bare button announced nothing when
                  the clipboard denied the call). */}
              <span
                dir="ltr"
                className="font-mono font-bold text-foreground inline-flex items-center gap-1"
              >
                {orderResult.order_code}
              </span>
              <CopyButton text={orderResult.order_code} label="نسخ" />
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* R115-I1 (A7 P3-8): money receipt — what was charged and
                what's left in the wallet. The charged amount comes from
                the order itself; the remaining balance appears the
                moment the post-charge /me refresh lands (never a stale
                pre-purchase number). */}
            <div className="bg-muted/20 border border-border/50 rounded-xl divide-y divide-border/30">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs font-bold text-muted-foreground">المبلغ المخصوم</span>
                <span className="font-bold text-sm tabular-nums text-foreground">
                  {formatCurrency(purchaseSummary?.charged ?? orderResult.amount ?? 0)}
                </span>
              </div>
              {purchaseSummary?.balanceAfter != null && (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-xs font-bold text-muted-foreground">رصيدك المتبقي</span>
                  <span className="font-bold text-sm tabular-nums text-status-success">
                    {formatCurrency(purchaseSummary.balanceAfter)}
                  </span>
                </div>
              )}
            </div>

            {/* Credentials box */}
            {(orderResult.delivered_email || orderResult.delivered_password) && (
              <div className="bg-muted/20 border border-border/50 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
                  {/* 96-F4 (R96 A6 #1): uppercase/tracking-wider removed —
                      no-op on Arabic but tears the letter joins visually.
                      R116-S2 (P3): h3 → h2 — the receipt jumps h1 → h3
                      (a skipped level); «بيانات الحساب» is the receipt's
                      section heading directly under the h1. */}
                  <h2 className="text-xs font-bold text-muted-foreground">بيانات الحساب</h2>
                </div>
                <div className="divide-y divide-border/25">
                  {orderResult.delivered_email && (
                    <CopyField label="البريد الإلكتروني" value={orderResult.delivered_email} />
                  )}
                  {orderResult.delivered_password && (
                    <CopyField label="كلمة المرور" value={orderResult.delivered_password} secret />
                  )}
                </div>
              </div>
            )}

            {/* R118-B2 (A2 fix, buyer side): the purchase succeeded and the
                order completed, but the credential payload could not be
                decrypted (backend decrypt_failed:true — delivered_* null).
                Previously the receipt just omitted the credentials box
                entirely, implying the product ships without account data.
                The honest notice rides the usage-terms warning idiom
                (status-warning card + icon) and hands the buyer the
                support link — support can re-deliver the credentials. */}
            {orderResult.decrypt_failed &&
              !orderResult.delivered_email &&
              !orderResult.delivered_password && (
                <div
                  role="alert"
                  className="bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-status-warning leading-relaxed">
                      تعذّر فك تشفير بيانات التسليم
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 mb-2.5">
                      طلبك مكتمل ومحفوظ، لكن بيانات الحساب تعذّر فك تشفيرها حالياً. تواصل مع الدعم
                      وستصلك بياناتك فوراً.
                    </p>
                    {/* A3-F13 (R120-B2): asChild — the old Link>Button
                        nesting rendered TWO same-named «تواصل مع الدعم»
                        elements (the anchor + an invalid
                        interactive-in-interactive button). One anchor,
                        one tab stop; order-decrypt-failed.test.tsx pins
                        the link role + label. */}
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 gap-1.5 rounded-xl font-bold"
                    >
                      <Link href="/support">
                        <Headphones className="w-3.5 h-3.5" />
                        تواصل مع الدعم
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

            {orderResult.delivered_extra_details && (
              /* 96-F4 (R96 A6 #7): free-text delivery details carry mixed-
                 direction runs (activation links / PIN codes inside Arabic
                 sentences) — dir="auto" + start alignment let the bidi
                 algorithm pick the base direction from the first strong
                 character instead of scrambling the visual order. */
              <div
                dir="auto"
                className="bg-muted/15 border border-border/40 rounded-xl px-4 py-3 text-sm text-muted-foreground leading-relaxed text-start"
              >
                {orderResult.delivered_extra_details}
              </div>
            )}

            {orderResult.delivered_usage_terms && (
              <div className="flex gap-2.5 text-sm bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                <span className="text-status-warning leading-relaxed">
                  {orderResult.delivered_usage_terms}
                </span>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <Button
                onClick={() => navigate("/orders")}
                /* R116-S2 CTA recipe: size=lg owns the primary surface. */
                size="lg"
                className="flex-1"
              >
                <ShoppingCart className="w-4 h-4 ml-1.5" />
                عرض طلباتي
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigate("/")} className="flex-1">
                تصفّح المزيد
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Product page ──────────────────────────────────────────────────────────
  const mobileContentPad = token ? "mobile-product-pad-auth" : "mobile-product-pad-guest";

  return (
    <div className={`max-w-xl lg:max-w-6xl mx-auto px-4 py-6 sm:py-8 sm:pb-8 ${mobileContentPad}`}>
      {seoBlock}
      {/* ── Visible breadcrumb (R124 / A1-F5) ─────────────────────────────
          Mirrors category.tsx's breadcrumb row (same nav label, classes,
          chevron idiom). Before this, the breadcrumb existed only as
          JSON-LD — invisible to shoppers — and the product's category
          badge on the hero was not a link, so a shopper who arrived via
          Home → /category/<x> → product had no way back to the category
          they were browsing. The middle segment links to the category
          landing page only when one exists (KNOWN_CATEGORIES). */}
      <nav
        aria-label="مسار التنقّل"
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 min-w-0"
      >
        <Link href="/" className="hover:text-foreground transition-colors press-spring shrink-0">
          الرئيسية
        </Link>
        {categoryMetaFor(product.category) && (
          <>
            {/* R124 (A1-F6): the separator denotes traversal FORWARD
                (parent → current), so in RTL it points LEFT — the app's
                unified forward=left chevron rule. (category.tsx's own
                separator had a stray rotate-180 making it the lone
                backwards exception — fixed in the same round.) */}
            <ChevronLeft className="w-3 h-3 opacity-50 shrink-0" aria-hidden="true" />
            <Link
              href={`/category/${product.category}`}
              className="hover:text-foreground transition-colors press-spring shrink-0"
            >
              {categoryMetaFor(product.category)!.label}
            </Link>
          </>
        )}
        <ChevronLeft className="w-3 h-3 opacity-50 shrink-0" aria-hidden="true" />
        <span className="text-foreground font-bold truncate" aria-current="page">
          {product.name}
        </span>
      </nav>

      {/* Back link */}
      {/* A3-F4 (R120-B2): min-h-11 — the 20px-tall text link measured
          112×20 live; the catalog escape hatch now clears the 44px touch
          floor (flex items-center centers the label inside the taller
          box).
          R124 (A1-F5): the escape hatch returns to the product's own
          CATEGORY when one exists (where the shopper most likely came
          from — previously it always dumped them on home); home stays one
          breadcrumb hop away, and unknown/retired categories keep the
          home fallback. The label names its destination honestly. */}
      <button
        onClick={() =>
          navigate(categoryMetaFor(product.category) ? `/category/${product.category}` : "/")
        }
        className="min-h-11 flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-4 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        {categoryMetaFor(product.category)
          ? `العودة إلى ${categoryMetaFor(product.category)!.label}`
          : "العودة للكتالوج"}
      </button>

      {/* R116-S2 (P2) — desktop split layout. Below lg this is the SAME
          single card as before: the wrapper carries the card chrome
          (max-lg:*) and every block keeps its exact former position via
          explicit flex `order-*` (image → title → long desc → features →
          variant selector → price → usage terms → error → trust → FAQ
          → mobile coupon → CTA). At lg the two <section>s materialize as
          grid columns (START = RTL-first/right: media + content; END =
          the sticky buy panel) — `max-lg:contents` dissolves them below
          lg so their children flow straight into the wrapper's flex
          column, which is what preserves the mobile sequence. */}
      <div
        className={`flex flex-col max-lg:gap-4 max-lg:bg-card max-lg:border max-lg:border-border/55 max-lg:rounded-2xl max-lg:overflow-hidden float-in max-lg:shadow-xl lg:grid lg:grid-cols-2 lg:items-start lg:gap-6`}
      >
        {/* ── START column (RTL first = right): media + description ── */}
        <section className="max-lg:contents lg:bg-card lg:border lg:border-border/55 lg:rounded-2xl lg:overflow-hidden lg:shadow-xl">
          {/* Image — max-lg:-mb-4 cancels the wrapper gap so the media stays
            flush against the card body exactly like the pre-split layout. */}
          <div
            className={`order-1 max-lg:-mb-4 aspect-[16/9] bg-gradient-to-b ${gradientClass} flex items-center justify-center relative overflow-hidden group/img`}
          >
            {/* Ambient inner glow */}
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-black/20 pointer-events-none" />

            {product.image_url ? (
              <img
                src={product.image_url}
                alt={(() => {
                  const name = (product.name ?? "").trim();
                  const cat = categoryLabel(product.category);
                  if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";
                  const hasSub = /اشتراك/.test(name);
                  return cat && cat !== "عام"
                    ? `${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()
                    : name;
                })()}
                width={800}
                height={800}
                fetchPriority="high"
                decoding="async"
                className="w-full h-full object-contain p-6 sm:p-8 transition-transform duration-500 ease-out group-hover/img:scale-[1.04] drop-shadow-2xl"
                // B4 P1-6: mirror ProductCard's fallback — a dead enrichment
                // URL swaps to the initial-letter tile instead of painting the
                // browser's broken-image glyph inside the page's largest
                // visual element. width/height (above) already pin the box.
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = "none";
                  const fallback = el.nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = "flex";
                }}
              />
            ) : null}

            {/* No-image fallback — always mounted (hidden when an image URL
              exists) so an onError above can reveal it without a re-render,
              exactly like ProductCard's category-icon fallback. */}
            <div
              style={{ display: product.image_url ? "none" : "flex" }}
              className="absolute inset-0 z-[2] items-center justify-center pointer-events-none"
            >
              <div className="flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm shadow-lg">
                <span
                  className={`text-5xl sm:text-6xl font-bold select-none drop-shadow-lg ${initialColorClass}`}
                >
                  {(product.name || "؟")[0]}
                </span>
              </div>
            </div>

            {/* Top badges — z-[3] keeps them above the z-[2] fallback layer
              (same stacking discipline as ProductCard's media area). */}
            <div className="absolute top-3 right-3 z-[3] bg-black/55 backdrop-blur-sm text-white/85 text-2xs font-bold px-2.5 py-1 rounded-full border border-white/8">
              {categoryLabel(product.category)}
            </div>
            {product.discount_percent && (
              /* R123-E4b (P3-h): text-primary-foreground — the shared token
                 every other primary-surface badge rides; raw text-white
                 broke the theme-tinted primary of the R115 palette. */
              <div className="absolute top-3 left-3 z-[3] flex items-center gap-1 bg-primary text-primary-foreground text-xs font-bold px-2.5 py-1 rounded-full shadow-lg shadow-primary/40">
                <Tag className="w-3 h-3" />
                خصم {product.discount_percent}%
              </div>
            )}

            {/* Fade into card body */}
            <div className="absolute inset-x-0 bottom-0 z-[3] h-20 bg-gradient-to-t from-card to-transparent" />
          </div>

          {/* R116-S2: below lg this dissolves (max-lg:contents) so its
            children join the wrapper's flex flow; at lg it is the START
            column's padded content stack (the image stays full-bleed
            above it inside the section card). */}
          <div className="max-lg:contents lg:p-5 lg:space-y-4">
            {/* Title */}
            <div className="order-2 max-lg:px-5 max-lg:pt-5">
              {/* R116-S2 (P3): dir="auto" (Latin-heavy product names were
                scrambled by the RTL base direction) + the dead
                leading-tight/tracking-tight overrides dropped — Arabic
                letter-spacing tears the cursive joins.
                R128-A2 (F-1): text-right re-anchors the ALIGNMENT to
                the RTL reading edge — pure-Latin names resolve dir=auto
                to ltr, so text-align:start computed LEFT and the h1
                floated up to 41px off the right line the breadcrumb and
                labels anchor to. Same fix as ProductCard's h3. */}
              <h1 dir="auto" className="text-fluid-2xl font-bold mb-1.5 text-right">
                {product.name}
              </h1>
              {product.description && (
                <p className="text-muted-foreground leading-relaxed text-sm">
                  {product.description}
                </p>
              )}
            </div>

            {/* Long-form description (Phase 2 SEO content) — rendered ONLY
              when an editor has provided one. Mirrors the value embedded
              in the Product JSON-LD so on-page text matches the
              structured data Google ingests. */}
            {productAny?.description_long && (
              <div className="order-3 max-lg:px-5 rounded-xl border border-border/45 bg-muted/15 p-4 text-sm text-foreground/85 leading-relaxed whitespace-pre-line">
                {productAny.description_long}
              </div>
            )}

            {/* Feature checklist (catalog 2026-09-20) — the imported Arabic
              bullets. Rendered as a real list (a11y: listitem semantics) with
              check icons; Google reads the same text into the product's
              content signals. */}
            {Array.isArray(productAny?.features) && productAny.features.length > 0 && (
              <ul className="order-4 max-lg:px-5 grid sm:grid-cols-2 gap-2 list-none">
                {productAny.features.map((feature: string) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/10 px-3.5 py-2.5 text-sm text-foreground/85 leading-relaxed"
                  >
                    <CheckCircle
                      className="w-4 h-4 mt-0.5 shrink-0 text-status-success"
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* R117 (F-3): the FAQ accordion now lives in the END (buy panel)
            column, directly after the trust grid — moving it there made
            the mobile DOM/reading order match the visual order (it used
            to sit here in DOM, right after the features list, while
            rendering visually after the trust grid — a WCAG 1.3.2
            divergence). See the R117 (F-3) comment at its new home. */}
        </section>

        {/* R116-S2: END column — at lg this is the sticky buy panel
          (selector → price → usage → error → trust → FAQ → coupon → CTA —
          the FAQ joined this column in R117 F-3 so mobile DOM order matches
          the visual order); below lg it dissolves (max-lg:contents) so the
          blocks keep their exact pre-split mobile order via flex
          order-5..order-12. */}
        <section className="max-lg:contents lg:self-start lg:sticky lg:top-24 lg:bg-card lg:border lg:border-border/55 lg:rounded-2xl lg:overflow-hidden lg:shadow-xl">
          <div className="max-lg:contents lg:p-5 lg:space-y-4">
            {/* ── Variant selector (catalog 2026-09-20) ─────────────────────
              Plan × Duration matrix rendered as grouped pills. Shown only
              when the product carries >1 active option — single-option
              products skip the selector entirely (their price block IS the
              variant). Touch targets ≥ 44px, high-contrast selected state. */}
            {sortedVariants.length > 1 && (
              <div className="order-5 max-lg:px-5">
                <VariantSelector
                  variants={sortedVariants}
                  selectedId={selectedVariant?.id ?? null}
                  onSelect={setSelectedVariantId}
                />
              </div>
            )}

            {/* Price + stock */}
            {/* R117 (F-1): max-lg:mx-5 restores the 20px side gutter the
              pre-split p-5 container gave this tinted box on mobile —
              mx (not px) so the gutter sits OUTSIDE the rounded border. */}
            <div className="order-6 max-lg:mx-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-muted/20 border border-border/45 rounded-xl">
              <div className="flex-1">
                <div className="text-3xl font-bold text-primary leading-none tabular-nums">
                  {formatCurrency(displayPrice)}
                </div>
                {/* R115-I1 (A7 P2-1): the strike follows the EFFECTIVE
                  selection exactly like the duration pills below — the
                  SELECTED variant's base price when a variant is picked.
                  product.price is the MIN variant price (backend
                  contract), so the old strike showed «كان 25 د.ل → الآن
                  80 د.ل» nonsense during flash sales on any
                  non-cheapest option. */}
                {(selectedVariant ? selectedVariant.sale_price : product.sale_price) != null && (
                  <div className="text-muted-foreground text-sm line-through mt-1.5 tabular-nums">
                    {formatCurrency(selectedVariant ? selectedVariant.price : product.price)}
                  </div>
                )}
              </div>
              <div
                role="status"
                aria-live="polite"
                aria-label={
                  product.is_available
                    ? `المنتج متوفر، الكمية ${product.stock_count}`
                    : "نفد المخزون"
                }
                className={`flex items-center gap-1.5 self-start text-sm font-bold px-3 py-2 rounded-xl border ${
                  product.is_available
                    ? "bg-status-success/10 border-status-success/22 text-status-success"
                    : "bg-muted/50 border-border/50 text-muted-foreground"
                }`}
              >
                {product.is_available ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> متوفر (
                    {product.stock_count})
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" aria-hidden="true" /> نفد المخزون
                  </>
                )}
              </div>
            </div>

            {/* Usage terms */}
            {product.usage_terms && (
              <div className="order-7 max-lg:mx-5 flex gap-2.5 text-sm text-status-warning bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{product.usage_terms}</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="order-8 max-lg:mx-5 flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-4 py-3 rounded-xl shake"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Trust signals */}
            <div className="order-9 max-lg:px-5 grid grid-cols-3 gap-2">
              {TRUST_SIGNALS.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col items-center gap-1 p-2.5 bg-muted/15 border border-border/35 rounded-xl text-center transition-colors hover:bg-muted/25 hover:border-border/55"
                >
                  <item.icon className="w-5 h-5 text-muted-foreground mb-0.5" />
                  {/* A1-F12 (R120-B2): label text-xs (was text-2xs) — the
                      three conversion claims read as substance, not
                      decoration, beside the 20px icons. */}
                  <span className="text-xs font-bold text-foreground leading-tight">
                    {item.label}
                  </span>
                  <span className="text-3xs text-muted-foreground leading-tight">{item.desc}</span>
                </div>
              ))}
            </div>

            {/* R117 (F-3): FAQ moved here from the START column so the
              mobile DOM/reading/Tab order matches the visual order
              (WCAG 1.3.2 / 2.4.3) — pre-R117 it sat in DOM right after
              the features list while visually rendering after this trust
              grid, so keyboard users Tabbed from features straight to a
              visually distant block and back up. order-10 keeps it in
              the same visual slot at <lg; at lg it now closes the buy
              panel column under the trust grid. The section's lg:p-5 +
              space-y-4 provide desktop spacing; max-lg:mx-5 is the
              mobile gutter (R117 F-1 — mx, outside the bordered box). */}
            {productFaqs && (
              <details className="order-10 max-lg:mx-5 rounded-xl border border-border/45 bg-muted/10 overflow-hidden group">
                <summary className="flex items-center justify-between px-4 py-3 text-sm font-bold cursor-pointer select-none hover:bg-muted/20 transition-colors">
                  <span>الأسئلة الشائعة</span>
                  <span className="text-xs text-muted-foreground">{productFaqs.length}</span>
                </summary>
                <div className="border-t border-border/30 divide-y divide-border/30">
                  {productFaqs.map((faq, idx) => (
                    <details key={idx} className="group/q">
                      <summary className="flex items-start gap-2 px-4 py-3 text-sm font-bold text-foreground cursor-pointer select-none hover:bg-muted/15 transition-colors">
                        <span className="text-muted-foreground shrink-0">س{idx + 1}.</span>
                        <span className="flex-1">{faq.question}</span>
                      </summary>
                      <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground leading-relaxed">
                        {faq.answer}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            )}

            {/* Mobile coupon entry stays in the scrollable content; the sticky bar remains thumb-sized. */}
            {token && (
              <div className="order-11 max-lg:mx-5 sm:hidden rounded-xl border border-border/45 bg-muted/10 p-3">
                <CouponField
                  token={token}
                  couponInput={couponInput}
                  couponResult={couponResult}
                  couponError={couponError}
                  couponValidating={couponValidating}
                  onCouponChange={setCouponInput}
                  onCouponValidate={validateCoupon}
                  onCouponClear={clearCoupon}
                />
              </div>
            )}

            {/* CTA — desktop only (mobile uses sticky bar) */}
            <div className="order-12 max-lg:px-5 hidden sm:block">
              <CtaBlock
                token={token}
                product={product}
                user={user}
                userLoading={userLoading}
                displayPrice={couponResult ? couponResult.final_amount : displayPrice}
                canAfford={
                  !!(
                    user &&
                    (user.wallet_balance ?? 0) >=
                      (couponResult ? couponResult.final_amount : displayPrice)
                  )
                }
                shortfall={
                  (couponResult ? couponResult.final_amount : displayPrice) -
                  (user?.wallet_balance ?? 0)
                }
                isPending={buyPending}
                onBuy={handleBuyIntent}
                onAddToCart={handleAddToCart}
                onLogin={loginWithIntent}
                onWallet={walletWithReturn}
                couponInput={couponInput}
                couponResult={couponResult}
                couponError={couponError}
                couponValidating={couponValidating}
                onCouponChange={setCouponInput}
                onCouponValidate={validateCoupon}
                onCouponClear={clearCoupon}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Recommendations Section. Pass the resolved product id from
          either fetch path — `numericId` is 0 when the URL is a slug,
          so we MUST use product.id which is filled by both branches. */}
      <RecommendationsSection numericId={product.id} />

      {/* ── Sticky mobile buy bar ─────────────────────────── */}
      <div
        className={`sm:hidden z-[45] bg-card/97 backdrop-blur-xl border-t border-border/50 px-4 pt-3 shadow-2xl shadow-black/30 ${
          stickyBarHiddenByKeyboard
            ? /* R117 (F-2): the iOS virtual keyboard was covering the fixed
                 buy bar — the hook value existed since R116 but was never
                 consumed, so the bar stayed put under the keyboard. */
              "hidden"
            : ""
        } ${
          /* R117 (F-2): pure-CSS fallback for very short viewports
             (phone landscape) where the keyboard-visibility hook can't
             help — the bar would eat half the screen. */
          "[@media(max-height:480px)]:hidden"
        } ${
          token
            ? "fixed left-0 right-0 mobile-sticky-above-nav pb-3"
            : /* 96-F4 (R96 A1 M11) → R120-B7 (reviewer finding): guests
                 keep position:sticky — it lands with the content BEFORE
                 the footer enters, never covering the legal row (the one
                 advantage over the authed fixed bar) — but the pin no
                 longer sits at bottom-0: the guest bottom nav renders on
                 /product/* now, and a bottom-0 pin would dock UNDER the
                 60px fixed nav. mobile-sticky-above-nav (bottom:
                 --mobile-nav-h + safe-area) puts the bar's bottom edge
                 exactly at the nav's top edge mid-scroll — the same
                 clearance the authed fixed bar rides — while keeping the
                 dock-with-content landing at scroll end. -mx-4 restores
                 the full-bleed width inside the px-4 page root; pb-3
                 matches the authed bar's breathing (the nav owns the
                 env(safe-area) inset now, so the retired bottom-safe
                 utility's own inset padding is deliberately dropped). */
              "sticky -mx-4 mobile-sticky-above-nav pb-3"
        }`}
      >
        <CtaBlock
          token={token}
          product={product}
          user={user}
          userLoading={userLoading}
          displayPrice={couponResult ? couponResult.final_amount : displayPrice}
          canAfford={
            !!(
              user &&
              (user.wallet_balance ?? 0) >=
                (couponResult ? couponResult.final_amount : displayPrice)
            )
          }
          shortfall={
            (couponResult ? couponResult.final_amount : displayPrice) - (user?.wallet_balance ?? 0)
          }
          isPending={buyPending}
          onBuy={handleBuyIntent}
          onAddToCart={handleAddToCart}
          onLogin={loginWithIntent}
          onWallet={walletWithReturn}
          couponInput={couponInput}
          couponResult={couponResult}
          couponError={couponError}
          couponValidating={couponValidating}
          onCouponChange={setCouponInput}
          onCouponValidate={validateCoupon}
          onCouponClear={clearCoupon}
          compact
        />
      </div>
    </div>
  );
}

interface CouponResult {
  code: string;
  discount_amount: number;
  final_amount: number;
  type: string;
  value: number;
  description: string | null;
}

function CouponField({
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  token,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  couponInput: string;
  couponResult: CouponResult | null;
  couponError: string;
  couponValidating: boolean;
  token: string | null;
  onCouponChange: (v: string) => void;
  onCouponValidate: () => void;
  onCouponClear: () => void;
}) {
  if (!token) return null;
  return (
    <div className="space-y-1.5">
      {/* Input row */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Tag className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={couponInput}
            onChange={(e) => {
              onCouponChange(e.target.value.toUpperCase());
              if (couponResult) onCouponClear();
            }}
            onKeyDown={(e) => {
              // Gate on `couponValidating` too — a double-Enter during an
              // in-flight validate used to fire a second POST.
              if (e.key === "Enter" && !couponResult && !couponValidating) onCouponValidate();
            }}
            placeholder="رمز الكوبون"
            /* 96-F4 (R96 A1 M05 / A2 P3-1): the old text-sm override beat
               the shared Input's iOS-zoom-safe text-base → a 14px coupon
               field on the money path zoomed the whole page on focus.
               text-base under md restores 16px; autoComplete/enterKeyHint
               mirror checkout's coupon field (Enter already validates). */
            autoComplete="off"
            enterKeyHint="send"
            className="pr-9 h-11 text-base md:text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans"
            disabled={!!couponResult}
          />
        </div>
        {couponResult ? (
          <button
            onClick={onCouponClear}
            aria-label="إزالة الكوبون"
            className="min-h-11 px-3 rounded-lg border border-border/60 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all press-spring"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onCouponValidate}
            disabled={!couponInput.trim() || couponValidating}
            className="min-h-11 px-3 rounded-lg bg-muted/50 border border-border/60 text-xs font-bold hover:bg-muted hover:border-border transition-all press-spring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {couponValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "تحقق"}
          </button>
        )}
      </div>

      {/* Error */}
      {couponError && (
        <div
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          {couponError}
        </div>
      )}

      {/* Success */}
      {couponResult && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 text-xs bg-status-success/8 border border-status-success/20 rounded-lg px-3 py-2"
        >
          <div className="flex items-center gap-1.5 text-status-success">
            <CheckCircle className="w-3 h-3 shrink-0" />
            <span dir="ltr" className="font-mono font-bold">
              {couponResult.code}
            </span>
            <span>
              —{" "}
              {couponResult.type === "percentage"
                ? `${couponResult.value}%`
                : formatCurrency(couponResult.value)}{" "}
              خصم
            </span>
          </div>
          <span className="font-bold text-status-success">
            −{formatCurrency(couponResult.discount_amount)}
          </span>
        </div>
      )}
    </div>
  );
}

function CtaBlock({
  token,
  product,
  user,
  userLoading,
  displayPrice,
  canAfford,
  shortfall,
  isPending,
  onBuy,
  onAddToCart,
  onLogin,
  onWallet,
  compact,
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  token: string | null;
  product: Product;
  user?: User;
  /** R94-A1 #2 (P2): true while /api/auth/me is still resolving. Without
   * it, `user === undefined` made canAfford=false and the FIRST thing a
   * solvent buyer saw on a direct SEO landing was «تحتاج إضافة X د.ل /
   * رصيدك الحالي 0.00 د.ل» — a false money statement during the first
   * 200–800ms on 3G. */
  userLoading?: boolean;
  displayPrice: number;
  canAfford: boolean;
  shortfall: number;
  isPending: boolean;
  onBuy: () => void;
  onAddToCart?: () => void;
  onLogin: () => void;
  onWallet: () => void;
  compact?: boolean;
  couponInput?: string;
  couponResult?: CouponResult | null;
  couponError?: string;
  couponValidating?: boolean;
  onCouponChange?: (v: string) => void;
  onCouponValidate?: () => void;
  onCouponClear?: () => void;
}) {
  // Local navigate for the out-of-stock alternates link below. The
  // parent already passes onLogin/onWallet because both routes carry
  // intent context (?intent=, ?return=); the alternates link is a
  // pure browse jump with no payload, so wiring through one more
  // callback would just be ceremony.
  const [, navigate] = useLocation();

  // A9-5 (R126-L6): availability outranks auth. The sold-out branch
  // used to sit AFTER the !token branch, so a guest on a sold-out
  // product saw «تسجيل الدخول للشراء» promising a purchase the page's
  // own «نفد المخزون» chip denied — and post-login the CTA flipped to
  // the disabled state anyway. Sold-out now shows the honest disabled
  // state (compact: strike price + «بدائل» recovery link — a better
  // answer for guests too) for EVERYONE; the login gate only renders
  // for products that can actually be bought.
  if (!product.is_available) {
    // Recovery hint: instead of a dead-end disabled CTA, give the user
    // a clear alternate path. On desktop the body retains a calm
    // "check back later" line; on mobile the sticky bar swaps the
    // disabled button for an active "browse alternatives" link
    // routed to the same category — same intent, different stock.
    const altHref =
      product.category && KNOWN_CATEGORIES.has(product.category)
        ? `/category/${product.category}`
        : "/";

    if (compact) {
      return (
        <div className="flex items-center gap-3">
          <div className="flex-1 text-right">
            <div className="font-bold text-muted-foreground text-xl tabular-nums line-through">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-2xs text-muted-foreground/90 flex items-center gap-1 mt-0.5">
              <Lock className="w-3 h-3" aria-hidden="true" /> نفد المخزون
            </div>
          </div>
          <Button
            onClick={() => navigate(altHref)}
            variant="outline"
            className="shrink-0 h-12 min-w-[7.5rem] px-5 press-spring"
          >
            بدائل
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Button
          disabled
          aria-label="نفد المخزون — غير متاح للشراء حالياً"
          className="w-full h-12 text-base"
        >
          <Lock className="w-4 h-4 ml-2" /> نفد المخزون
        </Button>
        <Button
          onClick={() => navigate(altHref)}
          variant="outline"
          className="w-full h-11 text-sm press-spring"
        >
          تصفّح بدائل في نفس الفئة
        </Button>
        <p className="text-center text-xs text-muted-foreground">تحقّق لاحقاً، قد يعود قريباً</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className={`${compact ? "flex items-center gap-3" : "space-y-2"}`}>
        {compact && (
          /* R127-B13 §7.1 (via the R128 sweep): min-w-0 + truncate on the
             compact price stack — the price is the bar's widest
             unbreakable token, and a flex child's automatic minimum
             width grows the bar past the viewport at 320px once a
             4+-digit price ships (the CTA is the shrink-0 twin). The
             full price stays visible in the buy panel above. */
          <div className="flex-1 min-w-0 text-right">
            <div className="font-bold text-primary text-xl tabular-nums truncate">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-xs text-muted-foreground">سجّل دخولك للشراء</div>
          </div>
        )}
        <Button
          onClick={onLogin}
          className={`${compact ? "shrink-0 h-12 min-w-[8rem] px-5" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring`}
        >
          {/* R115-I1 (A7 P3-12): the app-standard «سجّل دخولك» form
              (cart.tsx:333 + login.tsx family) — the shadda-less
              «سجل الدخول للشراء / سجل للشراء» were the only outliers. */}
          {compact ? "سجّل دخولك للشراء" : "تسجيل الدخول للشراء"}
        </Button>
        {/* R124 (A1-F4) → A9-4 (R126-L6): guests get the same
            add-to-cart affordance the grid cards give them — the cart is
            local (ProductCard's CTA has no auth gate; addItem is a
            localStorage write, never a server POST), and the cart page
            already funnels guests through /login?redirect=/checkout, so
            the label says WHEN sign-in actually happens. A9-4 closed the
            desktop-only gap: the fix used to live exclusively in the
            hidden sm:block block, so the <640px majority never saw it —
            the compact sticky bar now carries the same guarded path
            (outline icon-button beside the login CTA, same
            `onAddToCart && product.is_available` gate as the desktop
            twin). */}
        {!compact && onAddToCart && product.is_available && (
          <Button
            onClick={onAddToCart}
            variant="outline"
            className="w-full h-11 border-border/60 text-muted-foreground hover:text-foreground hover:border-border font-bold rounded-xl gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            أضف للسلة — سجّل الدخول عند إتمام الطلب
          </Button>
        )}
        {compact && onAddToCart && product.is_available && (
          <Button
            onClick={onAddToCart}
            variant="outline"
            aria-label="أضف للسلة — سجّل الدخول عند إتمام الطلب"
            className="shrink-0 h-12 w-12 border-border/60 text-muted-foreground hover:text-foreground hover:border-border press-spring"
          >
            <PlusCircle className="w-5 h-5" />
          </Button>
        )}
      </div>
    );
  }

  const couponField =
    !compact && onCouponChange && onCouponValidate && onCouponClear ? (
      <CouponField
        token={token}
        couponInput={couponInput ?? ""}
        couponResult={couponResult ?? null}
        couponError={couponError ?? ""}
        couponValidating={couponValidating ?? false}
        onCouponChange={onCouponChange}
        onCouponValidate={onCouponValidate}
        onCouponClear={onCouponClear}
      />
    ) : null;

  // R94-A1 #2 (P2): balance still loading — show a neutral verifying
  // state instead of flashing the «رصيد غير كافٍ» branch at a solvent
  // user. Disabled button + spinner; lands on the real branch once /me
  // resolves (the boot probe usually pre-seeds the cache, so this is
  // mostly a cold-direct-landing state).
  if (userLoading) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {!compact && couponField}
        {compact && (
          <div className="flex-1 text-right">
            <div className="font-bold text-primary text-xl tabular-nums">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-xs text-muted-foreground">جارٍ التحقق من رصيدك…</div>
          </div>
        )}
        <Button
          disabled
          aria-busy="true"
          aria-label="جارٍ التحقق من رصيد المحفظة"
          className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-5" : "w-full h-12 text-base"} bg-primary/70 font-bold`}
        >
          <Loader2 className={`${compact ? "w-4 h-4" : "w-5 h-5"} ml-2 animate-spin`} />
          {compact ? "جارٍ التحقق…" : "جارٍ التحقق من رصيدك…"}
        </Button>
      </div>
    );
  }

  if (!canAfford) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {compact ? (
          <>
            {/* B13 §7.1 twin: min-w-0 + truncate (see the guest branch
                above). */}
            <div className="flex-1 min-w-0 text-right">
              <div className="font-bold text-primary text-xl tabular-nums truncate">
                {formatCurrency(displayPrice)}
              </div>
              <div className="text-xs text-destructive/75">
                تحتاج {formatCurrency(shortfall)} إضافية
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="shrink-0 h-12 min-w-[7.5rem] px-5 press-spring"
            >
              <Wallet className="w-4 h-4 ml-1.5" /> شحن
            </Button>
          </>
        ) : (
          <>
            {couponField}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/25 border border-border/50 rounded-xl col-span-2">
                <span className="text-muted-foreground">رصيدك الحالي</span>
                <span className="font-bold tabular-nums">
                  {formatCurrency(user?.wallet_balance ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-primary/8 border border-primary/20 rounded-xl col-span-2">
                <span className="text-muted-foreground">تحتاج إضافة</span>
                <span className="font-bold text-primary-text tabular-nums">
                  {formatCurrency(shortfall)}
                </span>
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="w-full h-12 text-base press-spring"
            >
              <Wallet className="w-5 h-5 ml-2" /> شحن المحفظة
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
      {!compact && couponField}
      {compact && (
        /* B13 §7.1 twin: min-w-0 + truncate (see the guest branch above). */
        <div className="flex-1 min-w-0 text-right">
          <div className="font-bold text-primary text-xl tabular-nums truncate">
            {formatCurrency(displayPrice)}
          </div>
          {/* R128-A6 (P4-4): the ✓ TEXT glyph is gone — lucide Check in
              its place (emoji/text-glyph-as-icon is off the icon
              contract). inline-flex keeps the icon on the reading line
              (RTL: text first, glyph to its left). */}
          <div className="text-xs text-status-success">
            <span className="inline-flex items-center gap-1">
              رصيد كافٍ
              <Check className="w-3 h-3" aria-hidden="true" />
            </span>
          </div>
        </div>
      )}
      <Button
        onClick={onBuy}
        disabled={isPending}
        className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring`}
      >
        <ShoppingCart className={`${compact ? "w-4 h-4" : "w-5 h-5"} ml-2`} />
        {isPending
          ? "جارٍ المعالجة…"
          : compact
            ? "اشترِ"
            : `اشترِ الآن — ${formatCurrency(displayPrice)}`}
      </Button>
      {/* Secondary path: multi-item funnel. A9-4 (R126-L6): the compact
          sticky bar carries it too (outline icon-button) — it used to be
          desktop-only, leaving the mobile majority with buy-only, no
          way to park the selection in the cart and keep shopping. */}
      {!compact && onAddToCart && product.is_available && (
        <Button
          onClick={onAddToCart}
          variant="outline"
          className="w-full h-11 border-border/60 text-muted-foreground hover:text-foreground hover:border-border font-bold rounded-xl gap-2"
        >
          <PlusCircle className="w-4 h-4" />
          أضف للسلة — أكمل الشراء مع منتجات أخرى
        </Button>
      )}
      {compact && onAddToCart && product.is_available && (
        <Button
          onClick={onAddToCart}
          variant="outline"
          aria-label="أضف للسلة"
          className="shrink-0 h-12 w-12 border-border/60 text-muted-foreground hover:text-foreground hover:border-border press-spring"
        >
          <PlusCircle className="w-5 h-5" />
        </Button>
      )}
      {/* Reassurance: tells the user exactly what will be deducted and
          what's left after — eliminates a hesitation moment where users
          tap and pause to mentally calculate "wait, will I still have
          something for next time?". Desktop-only; the mobile sticky bar
          already shows the balance via the «رصيد كافٍ» line in compact
          mode. */}
      {!compact && user && (
        <p className="text-center text-xs text-muted-foreground -mt-1">
          سيُخصم من رصيدك ({formatCurrency(user.wallet_balance ?? 0)} متاح)
        </p>
      )}
    </div>
  );
}

function RecommendationsSection({ numericId }: { numericId: number }) {
  const {
    data: recommendations = [],
    isLoading,
    isError,
  } = useGetProductRecommendations(numericId, {
    query: {
      queryKey: getGetProductRecommendationsQueryKey(numericId),
      enabled: !!numericId,
      staleTime: 5 * 60 * 1000,
      // R115-I1 (A7 P3-9): one genuine retry for transient failures — a
      // single blip used to kill the section silently on attempt #1.
      retry: 1,
    },
  });

  // R115-I1 (A7 P3-9): hide DELIBERATELY on a definitive failure (after
  // the retry above) or an empty payload. The recommendations rail is
  // decorative cross-sell — an error card inside the purchase funnel
  // is noise, and the product itself (already on screen, with its own
  // error/retry states) carries the page's honest surfaces. The retry
  // is what keeps this from being a silent vanish.
  if (isError || (!isLoading && recommendations.length === 0)) return null;

  return (
    <div className="mt-8 space-y-4">
      {/* A4-F9 (R120-B2): h2 (was h3) — this section heading sat directly
          under the page h1, skipping a level; the card titles below are
          h3 (one under their own section heading). */}
      <h2 className="text-lg font-bold pr-1">قد يعجبك أيضاً</h2>
      <div className="grid grid-cols-2 gap-3">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                // Mirrors the real card below (rounded-2xl p-3.5 + aspect-[4/3]
                // image + two text rows) so the grid doesn't jump on load.
                className="bg-card border border-border/50 rounded-2xl p-3.5 space-y-3 skeleton-shimmer"
              >
                <div className="aspect-[4/3] rounded-xl" />
                <div className="h-4 w-3/4 rounded-md" />
                <div className="h-3 w-1/2 rounded-md" />
              </div>
            ))
          : recommendations.map((r) => (
              /* R115-I1 (A7 P3-9): wouter <Link> instead of a raw <a href> —
                 the anchor did a FULL page reload (SPA state lost: cart
                 context, auth boot, scroll restoration) while every
                 other product surface navigates client-side.
                 R122 (A1 P2-8): the href is now SLUG-canonical — the
                 backend adds `slug` to the recommendations DTO in the
                 same push, but the generated type regen may land apart
                 from this edit, so the local widening reads it with the
                 `slug ?? id` fallback (the exact idiom cart.tsx and
                 ProductCard already use). Crawlers stop seeing
                 non-canonical /product/<id> internal links and the URL
                 bar stays clean on first paint. */
              <Link
                key={r.id}
                href={`/product/${(r as ProductRecommendation & { slug?: string | null }).slug ?? r.id}`}
                onClick={() => window.scrollTo(0, 0)}
                className="block bg-card border border-border/50 rounded-2xl p-3.5 space-y-3 cursor-pointer hover:border-primary/40 transition-all group"
              >
                <div className="aspect-[4/3] bg-muted/30 rounded-xl overflow-hidden relative">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt={r.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                      /* R115-I1 (A7 P3-9): ProductCard-parity fallback — a
                         dead enrichment URL swaps to the initial-letter
                         tile instead of painting the browser's
                         broken-image glyph inside the recommendation. */
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = "none";
                        const fallback = el.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  {/* Always-mounted fallback tile (hidden while an image
                      URL exists) so onError above can reveal it without
                      a re-render — the same idiom as the hero image. */}
                  <div
                    style={{ display: r.image_url ? "none" : "flex" }}
                    className="w-full h-full items-center justify-center"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 border border-border/40">
                      {/* R125-I7 (A7 B-6 class, computed): the first-letter
                          fallback rode muted-foreground/55 — 2.39:1 light /
                          3.19:1 dark on the muted/50 tile. Full
                          --muted-foreground measures 6.20:1 / 7.54:1. */}
                      <span className="text-xl font-bold text-muted-foreground select-none">
                        {(r.name || "؟")[0]}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold truncate mb-1">{r.name}</h3>
                  <div className="text-primary-text font-bold tabular-nums">
                    {formatCurrency(r.price)}
                  </div>
                </div>
              </Link>
            ))}
      </div>
    </div>
  );
}

// ── VariantSelector (catalog 2026-09-20) ────────────────────────────────────
// Plan × Duration matrix rendered as two stacked pill rows:
//   1. Plan row (فردي/ثنائي/عائلي…) — only when the product varies by plan.
//   2. Duration row (شهر واحد/3 أشهر…) with the per-option price — always
//      visible so the price comparison is inline (Libyan shoppers compare
//      monthly-equivalent value per option, not just the total).
//
// Mobile-first: pills wrap, min-height 44px (thumb rule), the selected state
// carries the accent ring + bold price, unavailable options dim out. The
// label text uses the Arabic labels imported with the catalog.
interface SelectableVariant {
  id: number;
  plan_label?: string | null;
  duration_label?: string | null;
  label: string;
  price: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  is_available: boolean;
}

function VariantSelector({
  variants,
  selectedId,
  onSelect,
}: {
  variants: SelectableVariant[];
  selectedId: number | null;
  onSelect: (variantId: number) => void;
}) {
  const plans = Array.from(new Set(variants.map((v) => v.plan_label ?? null)));
  const hasPlanAxis = plans.length > 1;
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];

  // The duration row always shows the SELECTED plan's options (or all
  // options when the product has no plan axis).
  const visibleDurations = hasPlanAxis
    ? variants.filter((v) => (v.plan_label ?? null) === (selected?.plan_label ?? null))
    : variants;

  return (
    <div
      className="rounded-xl border border-border/45 bg-muted/10 p-3.5 space-y-3"
      /* A4-F2 (R120-B2): role="group" (was "radiogroup") — the pills are
         real <button>s that already implement Space/Enter, but the radiogroup
         role PROMISES arrow-key navigation (WAI-ARIA radio pattern) and
         none was implemented, so arrow keys did nothing. aria-pressed
         toggle buttons only promise what they deliver; the group + label
         keeps the SR context of what the pills choose. */
      role="group"
      aria-label="اختر الباقة"
    >
      {hasPlanAxis && (
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-2">نوع الباقة</p>
          {/* R128-A2 (§4 polish): gap-3 — the page's own card-grid rhythm
              (every card grid is 12px); the selector read one step
              tighter than its page. */}
          <div className="flex flex-wrap gap-3">
            {plans.map((plan) => {
              // A plan pill is enabled when ANY of its options is available;
              // it carries no price (the duration row prices the option).
              const planVariants = variants.filter((v) => (v.plan_label ?? null) === plan);
              const planAvailable = planVariants.some((v) => v.is_available);
              const isPlanSelected = (selected?.plan_label ?? null) === plan;
              return (
                <button
                  key={plan ?? "default"}
                  type="button"
                  aria-pressed={isPlanSelected}
                  aria-disabled={!planAvailable || undefined}
                  disabled={!planAvailable}
                  onClick={() => {
                    // Switching plan selects that plan's cheapest option.
                    const cheapest = [...planVariants]
                      .filter((v) => v.is_available)
                      .sort((a, b) => a.price - b.price)[0];
                    if (cheapest) onSelect(cheapest.id);
                  }}
                  className={`min-h-11 px-4 rounded-xl border text-sm font-bold transition-all press-spring ${
                    isPlanSelected
                      ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/25"
                      : "bg-card text-foreground/80 border-border/50 hover:border-primary/45 hover:text-primary-text"
                  } ${!planAvailable ? "opacity-40 pointer-events-none" : ""}`}
                >
                  {plan}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2">المدة</p>
        {/* R128-A2 (§4 polish): gap-3 — same rhythm lift as the plan row
            above (the card grids' 12px). */}
        <div className="grid grid-cols-2 gap-3">
          {visibleDurations.map((v) => {
            const isSelected = v.id === selectedId;
            const eff = v.sale_price ?? v.price;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${v.label} — ${formatCurrency(eff)}`}
                aria-disabled={!v.is_available || undefined}
                disabled={!v.is_available}
                onClick={() => onSelect(v.id)}
                className={`min-h-11 flex flex-col items-start justify-center gap-0.5 px-3 py-2 rounded-xl border text-start transition-all press-spring ${
                  isSelected
                    ? "bg-primary/12 border-primary text-primary shadow-md shadow-primary/15"
                    : "bg-card border-border/50 hover:border-primary/40"
                } ${!v.is_available ? "opacity-40 pointer-events-none" : ""}`}
              >
                <span className="text-sm font-bold text-foreground leading-tight">
                  {v.duration_label ?? v.plan_label ?? v.label}
                </span>
                {/* R123-E4b (P3-h): text-xs — the type-scale token (12px)
                    nearest the one-off 13px; the pill's label above is
                    text-sm so the price keeps its subordinate step.
                    A13-F12 (R126-L6): the SELECTED pill's price rode
                    text-primary — --primary (dark: hsl(348 80% 48%) =
                    rgb(220,24,64)) measured 3.76:1 on the dark card at
                    12px bold (below the 4.5:1 AA floor; 12px bold is not
                    "large"), and 3.66:1 on the pill's own primary/12
                    tint. --status-error is the both-theme-safe red sale
                    ink: dark rgb(236,81,81) = 5.20:1 on the card /
                    5.05:1 on the composited pill tint; light
                    rgb(187,27,27) = 6.39:1 on the white card (the
                    R116-S1 measured value for this exact token) /
                    4.76:1 on the tint. --primary-text was rejected:
                    identical to --primary in light mode (3.95:1 on the
                    tint) — it fixes dark only; --destructive fails
                    light (3.73:1 on the tint). */}
                <span
                  className={`text-xs font-bold tabular-nums leading-none ${
                    isSelected ? "text-status-error" : "text-foreground/75"
                  }`}
                >
                  {formatCurrency(eff)}
                  {v.sale_price != null && (
                    <span className="ms-1.5 text-3xs font-normal text-muted-foreground line-through">
                      {formatCurrency(v.price)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
