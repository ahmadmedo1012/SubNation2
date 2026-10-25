import { EmptyHero } from "@/components/EmptyState";
// R167 (F11 — the orders extract family): wave 1 moved the R165/R166
// cluster divider + the filtered-empty pair; wave 2 (R167-A2) moved
// the ROW CARD + its atoms (STAGGER, StatusIcon, statusAccentBorder)
// verbatim to components/orders/OrderRow — the four source-scan
// suites that owned that markup at the PAGE address now read the
// page ∪ family surface (image-discipline / pages-contracts /
// semantics-depth / account-surfaces + storefront-r125).
import { OrderClusterDivider } from "@/components/orders/OrderClusterDivider";
import { OrdersEmptyResults } from "@/components/orders/OrdersEmptyResults";
import { OrderRow } from "@/components/orders/OrderRow";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/lib/auth";
import { getErrorMessage, NETWORK_ERROR_DESCRIPTION } from "@/lib/errors";
import { ORDER_COUNT_FORMS_SUBJECT, formatCount } from "@/lib/utils";
import { customFetch, type Order } from "@workspace/api-client-react";
// R165 (the R162 ADR §6.2): the pure cluster computation — runs of
// consecutive rows sharing one non-null order_group_id.
import { computeOrderGroupClusters } from "@/lib/order-groups";
import { CheckCircle, Clock, Layers, Package, ShoppingBag, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useSeo } from "@/hooks/useSeo";
import { FilterTabs, type FilterTabItem } from "@/components/ui/filter-tabs";

type OrderFilter = "all" | "pending" | "completed" | "failed";

/**
 * A9-3 (R126-L6): the filter chip state mirrors into ?filter= (the
 * home/admin deep-link idiom — R98-04). Whitelist for the mount-time
 * read: a hand-typed ?filter=bogus must not arm a phantom bucket.
 */
const ORDER_FILTER_VALUES = new Set<OrderFilter>(["all", "pending", "completed", "failed"]);

/** Seed the active filter chip from ?filter= (once, at mount). */
function readInitialFilterFromUrl(): OrderFilter {
  if (typeof window === "undefined") return "all";
  const raw = new URLSearchParams(window.location.search).get("filter");
  return raw && ORDER_FILTER_VALUES.has(raw as OrderFilter) ? (raw as OrderFilter) : "all";
}

// R120-B7 (reviewer finding — A6-F1 UI consumption): the route's page
// size for the accumulating list. The backend default limit is 200 (the
// cap that made order #201+ unreachable before ?page= existed).
const ORDERS_PAGE_SIZE = 200;

// R158-IMPL-D (ledger b): the filter chips now ride the shared
// ui/FilterTabs primitive (variant="chips") — the page-local
// FilterChip + FILTER_TONES hand-roll (the r138 calm-pill dialect,
// tone fills + counts) moved INTO the primitive, so the tones/counts
// stay page-owned HERE and only the dial ships down as data. The
// ?filter= URL write-back stays in the [filter] replaceState effect
// (onSelect receives the raw setter — the A9-3 deep-link contract
// orders-filter-url pins); aria-pressed + the 44px floor ride the
// primitive's pill.

// R136 (UX-1): OrderCardSkeleton moved verbatim into ui/Skeleton's
// SkeletonCard (the geometry this page's card skeleton defined — tile +
// title line + chip pair; the R125-I7 1px-stripe history note moved with
// it). The loading render below rides the primitive, which carries the
// role="status" + sr-only pair the hand-rolled card lacked.

export default function OrdersPage() {
  // R146 (audit-frontend-pages F4): RouteAnnouncer announces SPA
  // navigations by reading document.title — this page set none, so
  // wallet/orders/loyalty hops stayed silent for screen-reader users.
  // notifications.tsx's shape (the fallback's noindex rides the page
  // block itself now).
  const seoBlock = useSeo({
    title: "طلباتي — SubNation",
    description:
      "سجل مشترياتك في SubNation — تابع حالة كل طلب وبيانات التسليم والمبالغ من مكان واحد.",
    path: "/orders",
    robots: "noindex,follow",
  });
  const { token } = useAuth();
  const [, navigate] = useLocation();
  // A9-3 (R126-L6): seeds from ?filter= at mount (whitelisted) so a
  // refresh / shared «قيد الانتظار» deep link keeps its bucket.
  const [filter, setFilter] = useState<OrderFilter>(readInitialFilterFromUrl);

  // A9-3 (R126-L6): mirror the active chip into ?filter= via
  // replaceState (home.tsx's R98-04 idiom — same logical page, invisible
  // to wouter, no history spam). The default bucket strips the param so
  // the bare /orders URL stays canonical; unknown params a visitor
  // carries (?utm=…, a future ?tab=) are preserved untouched.
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (filter === "all") qs.delete("filter");
      else qs.set("filter", filter);
      const query = qs.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    } catch {
      // Exotic embedding contexts without history API — the chip still
      // works in-memory; only the URL reflection is lost.
    }
  }, [filter]);

  // R120-B7 (reviewer finding — A6-F1 UI consumption): the list rides
  // the accumulating useInfiniteQuery idiom (admin/orders.tsx 94-C2
  // A2 P1-1) over the route's ?page= param — a reseller past 200
  // orders could never reach order #201+ before. The page fetch is the
  // raw-URL idiom admin tickets already use (R120-B5 / A2-F9) — a
  // deliberate choice, not an orval gap (R187 I-F7: ListOrdersParams
  // DOES express `page`; the old "api-zod hand-edit note" it cited never
  // existed). The key keeps the "/api/orders" prefix so the product-page
  // and checkout purchase invalidations still refresh this list
  // (TanStack prefix match).
  const {
    data: ordersPages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingMoreOrders,
  } = useInfiniteQuery<Order[], Error>({
    queryKey: ["/api/orders", "load-more"],
    queryFn: async ({ pageParam, signal }) => {
      // R144-C1 (L16-3): rides customFetch — same URL/auth/signal; the
      // inline ok-guard + envelope parse collapses into the ApiError
      // path (getErrorMessage reads .data.error/.code exactly like the
      // hand-rolled body parse did; a body-less error falls to the
      // generic Arabic copy instead of the old `(HTTP ${status})`
      // suffix — that string was never rendered, FetchErrorCard copy is
      // generic). 20 s budget + boot-gate retry arrive by construction.
      try {
        const d = await customFetch<unknown>(`/api/orders?page=${pageParam as number}`, {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
          signal,
        });
        // B-F6 (R186): a well-formed-JSON but wrong-shaped 200 (proxy
        // envelope, future API shape change) is an ERROR, not an empty
        // purchase history — the empty hero must never mask a contract
        // drift (the notifications/loyalty shape-guard class). Flows into
        // the catch's preserve-cause wrap below.
        if (!Array.isArray(d)) throw new Error("تعذّر تحميل الطلبات");
        return d as Order[];
      } catch (err) {
        // preserve-caught-error: the original ApiError/network error rides
        // as `cause` for Sentry/console diagnostics.
        throw new Error(getErrorMessage(err) || "تعذّر تحميل الطلبات", { cause: err });
      }
    },
    initialPageParam: 1,
    // Frozen contract (A6-F2, the admin twins' honesty rule): the body
    // is a plain array with no total meta — a full page means the next
    // page MIGHT exist; the first short/empty page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === ORDERS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!token,
  });

  // R187 (B-F7): background refetch failures with stale rows still on
  // screen are NOT an error screen — only a failed first load is (the
  // referrals.tsx loadError derivation). Bare isError discarded
  // fully-rendered cached rows on a transient refetch failure.
  const loadError = isError && (ordersPages?.pages.length ?? 0) === 0;

  // Accumulated list — dedup by id (admin/tickets.tsx R120-B5 idiom):
  // a purchase between page requests shifts offset boundaries, so a
  // row can legitimately repeat across pages.
  const orders = useMemo(() => {
    const seen = new Set<number>();
    const rows: Order[] = [];
    for (const page of ordersPages?.pages ?? []) {
      for (const o of page) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        rows.push(o);
      }
    }
    return rows;
  }, [ordersPages]);

  // A single short page is the only case where the total is provably
  // known — otherwise the honest count is «عرض N» (admin/orders.tsx
  // 94-C2 A2 P1-1 wording: never a grand total the plain-array
  // contract can't know).
  const knownTotal = (ordersPages?.pages.length ?? 0) <= 1 && orders.length < ORDERS_PAGE_SIZE;

  useEffect(() => {
    // R122 (A11-F3): preserve the return path on the guest redirect —
    // the commerce flows' `?redirect=` idiom (cart/PDP/checkout); a
    // post-login user lands back on their order history, not `/`. The
    // path is read INSIDE the effect (not from the useLocation
    // subscription) so the redirect itself can't re-fire the effect and
    // eat the original target (checkout.tsx:548 idiom, generalized).
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
  }, [token, navigate]);

  // Round-3 (react-hooks/rules-of-hooks): this memo previously sat after
  // `if (!token) return null;` — a conditional hook. The guard moved to
  // render-time below; hooks always run in the same order now.
  // R146 (audit-frontend-pages F5): the buckets are memoized on [orders]
  // (the admin/topups.tsx R125-I2 idiom) — plain .filter() calls minted
  // fresh array identities every render, so the visibleOrders memo below
  // never actually memoized.
  const [pending, completed, failed] = useMemo(
    () => [
      orders.filter((o) => o.status === "pending"),
      orders.filter((o) => o.status === "completed"),
      orders.filter((o) => o.status === "failed" || o.status === "refunded"),
    ],
    [orders],
  );

  // R158-IMPL-D (ledger b): the chips dial for the shared FilterTabs —
  // the buckets (memoized above) stay the single truth; empty buckets
  // simply don't push a chip (the old JSX conditionals, as data).
  // R116-S2 (P3) rides on: the refunded/failed bucket keeps the INFO
  // tone (a refund is not a failure), pending rides warning, completed
  // success, «الكل» the primary trio.
  const filterItems: FilterTabItem<OrderFilter>[] = [
    { value: "all", label: "الكل", icon: Layers, count: orders.length },
  ];
  if (pending.length > 0) {
    filterItems.push({
      value: "pending",
      label: "قيد الانتظار",
      icon: Clock,
      count: pending.length,
      tone: "warning",
    });
  }
  if (completed.length > 0) {
    filterItems.push({
      value: "completed",
      label: "مكتمل",
      icon: CheckCircle,
      count: completed.length,
      tone: "success",
    });
  }
  if (failed.length > 0) {
    filterItems.push({
      value: "failed",
      /* R116-S2 (P3): «مُسترد» leads — most rows in this bucket are
         refunds (the money came back), not failures; info tone matches
         the row pill/accent (R115-I1 A8 P2-3). */
      label: "مُسترد / فشل",
      icon: Undo2,
      count: failed.length,
      tone: "info",
    });
  }

  // Apply the active filter chip. The "all" chip preserves the
  // existing default behaviour (every order, sorted by the API).
  const visibleOrders = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "pending") return pending;
    if (filter === "completed") return completed;
    return failed;
  }, [filter, orders, pending, completed, failed]);

  // R165 (the R162 ADR §6.2): the cluster runs over the VISIBLE list —
  // runs of ≥2 consecutive rows sharing one non-null order_group_id get
  // the «عملية شراء واحدة» divider. Pure module (lib/order-groups.ts)
  // so the tests pin the same definition the page renders.
  const groupClusters = useMemo(() => computeOrderGroupClusters(visibleOrders), [visibleOrders]);

  // R122 (A1-P2): guests get the list-shaped RouteSkeleton instead of
  // a bare null — checkout.tsx's R115-I1 guard (the white frame between
  // the lazy-skeleton swap-out and the redirect tick read as a blank
  // page on slow links). Same "list" shape ROUTE_SHAPES maps /orders to.
  if (!token) return <RouteSkeleton shape="list" />;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {seoBlock}
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-7 page-in flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            {/* R139 (precision): shadow-inner + the /12 fill retired —
                the flat page-header tile family every account page
                rides (wallet/loyalty/referrals/status). */}
            <ShoppingBag className="w-5 h-5 text-primary" />
          </div>
          <div>
            {/* R128-A4 (F-3): leading-tight removed — the base h1–h4 1.3
                Arabic-safe floor (index.css) owns the leading. */}
            {/* R-140-l (semantics): VERIFIED — the header block renders
                unconditionally, so exactly one h1 («طلباتي») rides every
                state (loading/error/empty/list); no h2+ exists (the
                filter chips are a toolbar, the rows are list lines, not
                sections). The list itself is a div card-list — the
                family idiom for stacked card lists (cart lines, wallet
                statement, loyalty history all div; only
                CartSummaryAside's receipt LINE ITEMS ride ul) — NOT a
                money table, so no table semantics apply here. */}
            <h1 className="text-2xl font-bold">طلباتي</h1>
            <p className="text-sm text-muted-foreground">سجل مشترياتك ومتابعة حالتها</p>
          </div>
        </div>
        {!isLoading && orders.length > 0 && (
          /* R139 (precision): the count chip drops its resting
             shadow-sm — a static badge, not a floating layer. */
          <div className="text-sm font-bold text-muted-foreground bg-card border border-border/60 px-3 py-1.5 rounded-full shrink-0">
            {/* R94-A1 #11 (P3): Arabic pluralization via the shared
                formatCount (طلبان / طلبات / طلباً) instead of a frozen
                singular «طلب» after every count. R120-B7 (A6-F1): once a
                second page may exist the count is what the list SHOWS
                («عرض N (الأحدث أولاً)», admin/orders.tsx honesty idiom),
                never a grand total the plain-array contract can't know.
                R166-A F16: the standalone count chip adopts the shared
                SUBJECT registry form («طلبان» — nominative). */}
            {knownTotal
              ? formatCount(orders.length, ORDER_COUNT_FORMS_SUBJECT)
              : `عرض ${formatCount(orders.length, ORDER_COUNT_FORMS_SUBJECT)} (الأحدث أولاً)`}
          </div>
        )}
      </div>

      {/* Filter chips. The "all" chip acts as a reset — only shown
          once there are at least two non-empty buckets, so a fresh
          user with one pending order doesn't see redundant filtering
          UI. Each tone-specific chip lights up when active using its
          status token (FilterTabs' tone prop); empty buckets stay
          hidden (the items array below only pushes non-empty ones). */}
      {!isLoading && orders.length > 0 && (
        <FilterTabs
          variant="chips"
          scrollable
          ariaLabel="تصفية الطلبات حسب الحالة"
          className="mb-5 slide-up"
          items={filterItems}
          value={filter}
          onSelect={setFilter}
        />
      )}

      {/* Loading */}
      {isLoading ? (
        <SkeletonCard count={4} wrapperClassName="space-y-2.5" />
      ) : loadError ? (
        /* Distinct from "no orders": an API outage / expired session
           previously fell into the empty state below — an incident read
           as "you never bought anything" (B4 P1-4, the last page in the
           purchase journey without an error branch). */
        <FetchErrorCard
          size="page"
          className="py-20 reveal-up"
          title="تعذّر تحميل الطلبات"
          /* R167-E (F15, the 10th and last site): the generic
             network-error description rides the shared constant
             (lib/errors.ts) — rendered bytes byte-identical. */
          description={NETWORK_ERROR_DESCRIPTION}
          /* R116-S2 (P3): 44px floor on the retry affordance (the
             drifted active:scale-[0.97] rides the global press-spring
             now). */
          retryClassName="min-h-11 gap-2"
          onRetry={() => refetch()}
        />
      ) : /* Empty state */
      orders.length === 0 ? (
        /* R136 (UX-1): EmptyHero — this page's hand-rolled hero WAS the
           geometry source for the component (py-20 + w-20 glow tile +
           text-lg title, the Sparkles CTA in the bare action slot);
           adoption nets role="status" on the loading→empty swap. */
        <EmptyHero
          icon={Package}
          title="لا توجد طلبات بعد"
          description="ابدأ بتصفح الكتالوج واشترِ أول اشتراك رقمي"
          action={
            /* R120-B7 (reviewer finding — A4-F1 sweep completion): asChild
                composition (cart.tsx ghost-CTA idiom) instead of Link>Button
                nesting — one anchor, one tab stop, identical styling. */
            <Button asChild className="min-h-11 gap-2">
              <Link href="/">
                <Sparkles className="w-4 h-4" />
                تصفح الكتالوج
              </Link>
            </Button>
          }
        />
      ) : visibleOrders.length === 0 ? (
        /* R167 (F11): the filtered-empty pair (the R120-B7 load-more
           honesty branch + the drop-the-filter branch) moved verbatim
           to components/orders/OrdersEmptyResults.tsx — values +
           callbacks only. */
        <OrdersEmptyResults
          hasNextPage={hasNextPage}
          loadingMore={loadingMoreOrders}
          parentLoading={isLoading}
          onLoadMore={() => void fetchNextPage()}
          onShowAll={() => setFilter("all")}
        />
      ) : (
        /* Orders list */
        <div className="space-y-2.5">
          {visibleOrders.map((order, i: number) => {
            // R165 (the R162 ADR §6.2): the cluster divider — rendered
            // ABOVE the run's first row only (presentational; every row
            // keeps its own identity/amount/status + link).
            const clusterRun = groupClusters.get(i);
            return (
              <div key={order.id} className="space-y-2">
                {clusterRun !== undefined && (
                  /* R167 (F11): the chip itself is a verbatim extract
                     (components/orders/OrderClusterDivider) — the run
                     computation + this placement gate stay page-owned. */
                  <OrderClusterDivider runCount={clusterRun} />
                )}
                {/* R167 (F11, wave 2 — R167-A2): the row card + its
                    atoms (STAGGER / StatusIcon / statusAccentBorder)
                    moved verbatim to components/orders/OrderRow — the
                    stagger index rides the position prop. */}
                <OrderRow order={order} index={i} />
              </div>
            );
          })}

          {/* R120-B7 (reviewer finding — A6-F1): append-in-place
              «تحميل المزيد» (admin/orders.tsx 94-C2 A2 P1-1 idiom) —
              a reseller past 200 orders could never reach order #201+
              before the route grew ?page=. Hidden once a page comes
              back short (the plain-array contract's definite end). */}
          {hasNextPage && (
            <div className="flex justify-center pt-3">
              <LoadMoreButton
                size="default"
                className="min-h-11 gap-1.5"
                iconClassName="w-4 h-4"
                busy={loadingMoreOrders}
                disabled={isLoading}
                onClick={() => void fetchNextPage()}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
