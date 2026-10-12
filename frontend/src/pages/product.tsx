import { Button } from "@/components/ui/button";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
// R135 (FE-3 decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/product/* (verbatim moves — the money
// path, state atoms and every handler stay HERE; the extracts render the
// byte-identical DOM they rendered inline yesterday). Import surface:
//   • buy-intent-key / category-presentation — the page's pure modules
//   • CopyField/CouponField/CtaBlock/VariantSelector/Recommendations —
//     the page's own already-encapsulated subtrees
//   • OrderSuccessScreen/ProductMediaSection/PriceStockPanel/
//     TrustSignals/FaqAccordion — this round's section extractions
import {
  buyIntentFingerprint,
  clearBuyIntentKey,
  loadBuyIntentKey,
  persistBuyIntentKey,
  toCents,
} from "@/components/product/buy-intent-key";
import { KNOWN_CATEGORIES, categoryMetaFor } from "@/components/product/category-presentation";
import { CouponField, type CouponResult } from "@/components/product/CouponField";
import { CtaBlock } from "@/components/product/CtaBlock";
import { FaqAccordion } from "@/components/product/FaqAccordion";
import {
  OrderSuccessScreen,
  type PurchaseSummary,
} from "@/components/product/OrderSuccessScreen";
import { PriceStockPanel } from "@/components/product/PriceStockPanel";
import { ProductMediaSection } from "@/components/product/ProductMediaSection";
import { RecommendationsSection } from "@/components/product/RecommendationsSection";
import { TrustSignals } from "@/components/product/TrustSignals";
import { VariantSelector } from "@/components/product/VariantSelector";
import { useSeo } from "@/hooks/useSeo";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { buildBreadcrumbLd, buildFaqLd, buildProductLd } from "@/lib/seo-builders";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility";
import { quietNextScrollToTopReset } from "@/lib/navigation-quiet";
import {
  createOrder,
  customFetch,
  getGetMeQueryKey,
  getGetProductQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
  getMe,
  getProduct,
  type CreateOrderBody,
  type Order,
  type Product,
  useGetMe,
  useGetProduct,
} from "@workspace/api-client-react";
import { AlertCircle, ArrowRight, ChevronLeft, Home, Info, Package } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { addItem } = useCart();
  // R135 (FE-3): the order-result atom was previously UNTYPED (a bare
  // null-initialized state) — now the orval-generated Order
  // contract from @workspace/api-client-react (createOrder's response
  // type). Every field the success receipt reads (order_code, amount,
  // delivered_*, decrypt_failed) lives on it — a typing change only,
  // zero runtime difference.
  const [orderResult, setOrderResult] = useState<Order | null>(null);
  // R115-I1 (A7 P3-8): the buy-success money receipt — the charged amount
  // + the post-charge wallet balance. balanceAfter stays null until the
  // cache:"no-store" /me refresh lands: a STALE pre-purchase balance
  // must never be presented as "remaining" on the success screen.
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseSummary | null>(null);
  const [error, setError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponValidating, setCouponValidating] = useState(false);
  // R135 (FE-3): the inline validate-response shape moved to CouponField's
  // exported CouponResult — one source for the page state + the CTA props.
  const [couponResult, setCouponResult] = useState<CouponResult | null>(null);
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
  // PWA resume via durable localStorage (R135/FE-3: the helpers moved to
  // @/components/product/buy-intent-key.ts — see that module's docblock
  // for the full lifecycle: TTL + price/coupon fingerprint + terminal-only
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
      } catch (err) {
        // Fail-open (98-F2 contract): the displayed price stands; the
        // server re-prices the order on its side regardless.
        // R134 (A2-F8): a 404 is NOT a transient fetch failure — it is
        // definitive (R110-F: deactivated/archived products 404 on both
        // detail routes). Fail-opening on it let createOrder run into a
        // guaranteed 400/404 banner; the page already owns the honest
        // state for this verdict — a refetch flips it into the real
        // «المنتج غير موجود» branch (the cart path's twin of dropping
        // 404/410-archived lines with a notice). Network/5xx failures
        // keep the fail-open contract above.
        if (
          err instanceof Error &&
          err.name === "ApiError" &&
          (err as { status?: number }).status === 404
        ) {
          try {
            void refetchProduct();
          } catch {
            // best-effort UI refresh — the toast still explains the abort
          }
          couponGenerationRef.current += 1;
          setCouponResult(null);
          setCouponError("");
          toast({
            title: "المنتج لم يعد متوفراً",
            description: "هذا المنتج لم يعد متوفراً — يتم تحديث الصفحة لتصفّح البدائل.",
          });
          return;
        }
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
    // R130 (A1-F2): a refused raise (stock-aware ceiling) gets the honest
    // ceiling toast — the success toast was promising a badge change the
    // cap never made.
    const applied = addItem({
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
      // R129-A1 (F1 wiring — B-11): same as the card — the PDP's own
      // availability line («المنتج متوفر، الكمية N») reads
      // product.stock_count; the cart snapshot captures the same number
      // so both surfaces agree. Variants carry no stock of their own.
      stockCount: product.stock_count,
    });
    if (applied) {
      toast({
        title: "أُضيف إلى السلة",
        description: selectedVariant
          ? `${product.name} — ${selectedVariant.label}`
          : (product.name ?? undefined),
      });
    } else {
      toast({
        title: "بلغت الحد الأقصى المتاح",
        description:
          product.stock_count != null
            ? `${product.name} — متبقٍ ${product.stock_count} فقط`
            : (product.name ?? undefined),
      });
    }
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
          <Package className="w-7 h-7 text-status-error" aria-hidden="true" />
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
  // R135 (FE-3): the receipt's markup moved verbatim to OrderSuccessScreen —
  // the page still owns orderResult/purchaseSummary (handleBuyIntent seeds
  // them after the charge) and passes them down as values.
  if (orderResult) {
    return <OrderSuccessScreen order={orderResult} purchaseSummary={purchaseSummary} />;
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
        {/* R135 (FE-3): the START column moved verbatim to ProductMediaSection
            (media + badges + title + description + long-form description +
            features checklist — same elements, classes, DOM order and the
            category gradient/initial lookups computed inside it). */}
        <ProductMediaSection product={product} />

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

            {/* Price + stock — R135 (FE-3): the box moved verbatim to
                PriceStockPanel (its R117 F-1 gutter + R115-I1 strike
                comments moved with it). displayPrice and the effective
                selection stay owned by the page — one source. */}
            <PriceStockPanel
              product={product}
              selectedVariant={selectedVariant}
              displayPrice={displayPrice}
            />

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

            {/* Trust signals — R135 (FE-3): the static grid moved verbatim to
                TrustSignals (the order-9 wrapper rides its root, preserving
                the R117 F-1 gutter contract). */}
            <TrustSignals />

            {/* FAQ — R135 (FE-3): the accordion moved verbatim to FaqAccordion;
                the R117 (F-3) DOM-order comment moved with it. Rendered only
                when the curated list is non-empty (the same page-level guard
                gates the FAQPage JSON-LD against thin structured data). */}
            {productFaqs && <FaqAccordion faqs={productFaqs} />}

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
