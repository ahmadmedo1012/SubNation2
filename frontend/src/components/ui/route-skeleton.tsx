import { cn } from "@/lib/utils";

/**
 * Route-level skeleton shells. Replace the spinner-in-the-middle
 * Suspense fallback with a layout that matches the shape of the
 * page being loaded — so the swap from skeleton → real content
 * is a content-fill transition, not a layout shift.
 *
 * `shape` picks the broad page archetype:
 *   • catalog — hero band + filter row + product grid (home)
 *   • list    — header + stacked rows (orders / wallet ledger / referrals)
 *   • detail  — hero card + body sections (product / order-detail)
 *   • form    — narrow card with stacked fields (login / register / onboarding)
 *   • admin   — sidebar-aware shell with table-style rows
 *   • blank   — flat background only (chromeless callback pages)
 *   • checkout — max-w-5xl two-column shell: payment/coupon stack + 360px
 *     sticky summary aside (mirrors pages/checkout.tsx exactly).
 *
 * 93-C7 / C-UX1 (A12 F-09, doc-rot removal): the checkout shape IS
 * wired — App.tsx ROUTE_SHAPES maps /^\/checkout/ → "checkout"
 * (App.tsx:114, round-92 C7). The stale NOTE that claimed otherwise
 * was deleted so future agents stop re-fixing a non-issue.
 *
 * All shells use `skeleton-shimmer` so they share the brand-tinted
 * sweep introduced in the theme polish pass.
 */
export type RouteSkeletonShape =
  | "catalog"
  | "list"
  | "detail"
  | "form"
  | "admin"
  | "blank"
  | "product"
  | "order"
  | "checkout";

interface RouteSkeletonProps {
  shape?: RouteSkeletonShape;
  className?: string;
}

export function RouteSkeleton({ shape = "blank", className }: RouteSkeletonProps) {
  return (
    <div
      className={cn("min-h-[60vh]", className)}
      role="status"
      aria-live="polite"
      aria-label="جاري تحميل الصفحة"
    >
      {shape === "catalog" && <CatalogShell />}
      {shape === "list" && <ListShell />}
      {shape === "detail" && <DetailShell />}
      {shape === "form" && <FormShell />}
      {shape === "admin" && <AdminShell />}
      {shape === "blank" && <BlankShell />}
      {shape === "product" && <ProductShell />}
      {shape === "order" && <OrderShell />}
      {shape === "checkout" && <CheckoutShell />}
    </div>
  );
}

function BlankShell() {
  return <div className="min-h-[60vh] bg-background" />;
}

function CatalogShell() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-5 sm:py-7">
      {/* Hero band */}
      <div className="rounded-3xl skeleton-shimmer h-[160px] sm:h-[200px] mb-6" />
      {/* Filter row */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 h-10 rounded-xl skeleton-shimmer" />
        <div className="w-28 h-10 rounded-xl skeleton-shimmer" />
      </div>
      <div className="flex gap-2 mb-5 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-24 rounded-xl skeleton-shimmer" />
        ))}
      </div>
      {/* Product grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductCardShell key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Standalone product-card skeleton. Mirrors the dimensions of
 * <ProductCard/> so the visual swap is invisible.
 */
export function ProductCardShell() {
  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <div className="aspect-square skeleton-shimmer" />
      <div className="p-3.5 space-y-2.5">
        <div className="flex justify-between gap-2">
          <div className="h-3.5 skeleton-shimmer rounded-lg w-3/5" />
          <div className="h-3.5 skeleton-shimmer rounded-full w-14" />
        </div>
        <div className="h-2.5 skeleton-shimmer rounded w-full" />
        <div className="h-2.5 skeleton-shimmer rounded w-4/5" />
        <div className="pt-2.5 mt-1 flex justify-between items-center border-t border-border/25">
          <div className="h-4 skeleton-shimmer rounded w-20" />
          <div className="h-5 w-10 skeleton-shimmer rounded-full" />
        </div>
      </div>
      {/* 96-F4 (R96 A1 M12): mobile CTA placeholder — every REAL card renders
          an always-visible `md:hidden min-h-11` buy button (or the «نفد
          المخزون» bar) below the details block; the skeleton mirrored only
          the image + text rows, so each card grew ~58px on the skeleton →
          content swap of the 8-card mobile grid — a visible CLS jump on the
          highest-traffic page. Same geometry classes as the real CTA. */}
      <div className="md:hidden min-h-11 mx-3.5 mb-3.5 rounded-xl skeleton-shimmer" />
    </div>
  );
}

function ListShell() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-7">
      <div className="h-7 w-40 skeleton-shimmer rounded-lg mb-5" />
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] rounded-2xl skeleton-shimmer"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function DetailShell() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="rounded-3xl skeleton-shimmer aspect-[4/3] sm:aspect-[16/9] mb-5" />
      <div className="space-y-3">
        <div className="h-7 skeleton-shimmer rounded-lg w-2/3" />
        <div className="h-4 skeleton-shimmer rounded w-full" />
        <div className="h-4 skeleton-shimmer rounded w-5/6" />
        <div className="h-4 skeleton-shimmer rounded w-4/6" />
      </div>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl skeleton-shimmer" />
        ))}
      </div>
    </div>
  );
}

/**
 * Product-page shell. Mirrors pages/product.tsx exactly — max-w-xl
 * container, 16:9 media area inside a card, price/CTA row, then the
 * trust/sections stack — so the chunk-load swap causes zero horizontal
 * reflow (the generic DetailShell at max-w-4xl used to shift the layout
 * by 256px on this highest-traffic page).
 */
function ProductShell() {
  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <div className="h-5 w-28 skeleton-shimmer rounded-lg mb-5" />
      <div className="bg-card border border-border/55 rounded-2xl overflow-hidden">
        <div className="aspect-[16/9] skeleton-shimmer" />
        <div className="p-5 space-y-3">
          <div className="h-6 skeleton-shimmer rounded-lg w-3/4" />
          <div className="h-4 skeleton-shimmer rounded w-full" />
          <div className="h-4 skeleton-shimmer rounded w-2/3" />
          <div className="pt-4 mt-2 flex justify-between items-center border-t border-border/25">
            <div className="h-7 w-24 skeleton-shimmer rounded-lg" />
            <div className="h-11 w-36 skeleton-shimmer rounded-xl" />
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-2.5">
        <div className="h-4 w-40 skeleton-shimmer rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-2xl skeleton-shimmer"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Order-detail shell. Mirrors pages/order-detail.tsx — max-w-2xl,
 * status hero strip + stacked timeline rows.
 */
function OrderShell() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="h-7 w-48 skeleton-shimmer rounded-lg mb-4" />
      <div className="h-20 rounded-2xl skeleton-shimmer mb-5" />
      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-2xl skeleton-shimmer"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function FormShell() {
  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <div className="h-8 w-32 skeleton-shimmer rounded-lg mx-auto mb-6" />
      <div className="bg-card border border-border/55 rounded-3xl p-6 space-y-4">
        <div className="h-10 skeleton-shimmer rounded-xl" />
        <div className="h-10 skeleton-shimmer rounded-xl" />
        <div className="h-10 skeleton-shimmer rounded-xl mt-2" />
        <div className="h-11 skeleton-shimmer rounded-xl mt-2" />
      </div>
    </div>
  );
}

/**
 * Checkout shell. Mirrors pages/checkout.tsx — max-w-5xl container,
 * icon+title header, then a `md:grid-cols-[1fr_360px]` grid: left
 * column = payment-method card + coupon card, right = the 360px
 * summary aside. Same geometry as the real page so the chunk-load
 * swap causes zero horizontal reflow on the money-critical route
 * (B4 P1-5 / B6-P1-5).
 */
function CheckoutShell() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-7">
        <div className="w-11 h-11 rounded-xl skeleton-shimmer" />
        <div className="space-y-1.5">
          <div className="h-6 w-32 skeleton-shimmer rounded-lg" />
          <div className="h-3.5 w-56 skeleton-shimmer rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
        {/* Payment + coupon stack (main column) */}
        <div className="space-y-4">
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4">
            <div className="h-5 w-28 skeleton-shimmer rounded-lg" />
            <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40">
              <div className="w-10 h-10 rounded-lg skeleton-shimmer shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-36 skeleton-shimmer rounded" />
                <div className="h-3 w-24 skeleton-shimmer rounded" />
              </div>
            </div>
            <div className="h-3 w-full skeleton-shimmer rounded" />
          </div>
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-3">
            <div className="h-5 w-32 skeleton-shimmer rounded-lg" />
            <div className="h-10 skeleton-shimmer rounded-xl" />
            <div className="h-3 w-4/5 skeleton-shimmer rounded" />
          </div>
          <div className="flex items-center gap-2 px-1">
            <div className="w-4 h-4 rounded-full skeleton-shimmer" />
            <div className="h-3 w-40 skeleton-shimmer rounded" />
          </div>
        </div>
        {/* Summary aside (360px) */}
        <div className="md:sticky md:top-20 md:self-start">
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-3">
            <div className="h-5 w-24 skeleton-shimmer rounded-lg mb-1" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg skeleton-shimmer shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 skeleton-shimmer rounded w-3/4" />
                  <div className="h-3 skeleton-shimmer rounded w-1/3" />
                </div>
                <div className="h-3.5 w-14 skeleton-shimmer rounded" />
              </div>
            ))}
            <div className="pt-3 mt-2 border-t border-border/25 flex justify-between items-center">
              <div className="h-4 w-16 skeleton-shimmer rounded" />
              <div className="h-5 w-20 skeleton-shimmer rounded-lg" />
            </div>
            <div className="h-11 skeleton-shimmer rounded-xl mt-2" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminShell() {
  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="h-7 w-44 skeleton-shimmer rounded-lg" />
        <div className="h-9 w-28 skeleton-shimmer rounded-xl" />
      </div>
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="h-12 border-b border-border/40 skeleton-shimmer" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-14 border-b border-border/30 last:border-0 skeleton-shimmer"
            style={{ animationDelay: `${i * 30}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
