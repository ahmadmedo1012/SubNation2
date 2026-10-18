import { EmptyHero, EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import {
  ORDER_COUNT_FORMS_SUBJECT,
  formatCount,
  formatCurrency,
  formatDateShort,
  statusLabel,
} from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { customFetch, type Order } from "@workspace/api-client-react";
// R165 (the R162 ADR §6.2): the pure cluster computation — runs of
// consecutive rows sharing one non-null order_group_id.
import { computeOrderGroupClusters } from "@/lib/order-groups";
import {
  CheckCircle,
  ChevronLeft,
  Clock,
  Layers,
  Package,
  ShoppingBag,
  Sparkles,
  Tag,
  Undo2,
  XCircle,
} from "lucide-react";
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

const STAGGER = [
  "",
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
  "stagger-7",
  "stagger-8",
  "stagger-9",
  "stagger-10",
  "stagger-11",
  "stagger-12",
];

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="w-3.5 h-3.5 text-status-success" />;
  // R115-I1 (A8 P2-3): refunded is NOT a failure — the money came back.
  // The old red XCircle on a refunded row (while its status pill is BLUE
  // status-info via statusColor) read as a failed purchase; the calm
  // info tone + undo glyph now match the pill (utils.ts statusLabel
  // «مُسترد» / statusColor status-info).
  if (status === "refunded") return <Undo2 className="w-3.5 h-3.5 text-status-info" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-status-error" />;
  return <Clock className="w-3.5 h-3.5 text-status-warning" />;
}

function statusAccentBorder(status: string): string {
  // 93-C5 / F-15 (A4 #4): the card mixes a LOGICAL width (border-s-[3px] =
  // right edge in RTL) with a PHYSICAL color (border-l-* = left edge) —
  // the status tint landed on the opposite 1px edge, leaving a neutral
  // 3px bar and an effectively invisible status accent for every RTL
  // user (i.e. everyone). One system now: physical border-r-* on BOTH,
  // matching support.tsx's ticket-card idiom (border-r-[3px] +
  // border-r-blue-500/55).
  // R115-I1 (A8 P2-3): refunded carries the info accent — matches the
  // pill + icon instead of the error red it used to share with failed.
  if (status === "completed") return "border-r-status-success/55";
  if (status === "refunded") return "border-r-status-info/55";
  if (status === "failed") return "border-r-status-error/55";
  return "border-r-status-warning/45";
}

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
  // orders could never reach order #201+ before. The generated client
  // can't express `page` yet (orval/zod alignment pending — see the
  // api-zod hand-edit note), so the page fetch is the raw-URL idiom
  // admin tickets already use (R120-B5 / A2-F9). The key keeps the
  // "/api/orders" prefix so the product-page and checkout purchase
  // invalidations still refresh this list (TanStack prefix match).
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
        return Array.isArray(d) ? (d as Order[]) : [];
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
      ) : isError ? (
        /* Distinct from "no orders": an API outage / expired session
           previously fell into the empty state below — an incident read
           as "you never bought anything" (B4 P1-4, the last page in the
           purchase journey without an error branch). */
        <FetchErrorCard
          size="page"
          className="py-20 reveal-up"
          title="تعذّر تحميل الطلبات"
          description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
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
        hasNextPage ? (
          /* R120-B7 (A6-F1, admin/orders.tsx R115 A9 P2 pattern): the
             filter chips run CLIENT-SIDE over the accumulated pages, so
             an active bucket can read «لا توجد طلبات» while matching
             rows sit on unloaded pages (hasNextPage=true). The hard
             empty state was a false claim; keep the load-more visible
             + the honest incompleteness hint instead.
             R135 (FE-2): converged on the storefront EmptyState — this
             block WAS the compact-tile idiom the component canonized
             (same w-12/w-5/opacity-35 shape, identical strings/CTAs);
             adoption nets role="status" so the loading→empty swap
             announces (R125 A6 B-8, admin parity — the hand-rolled div
             was silent). */
          <EmptyState
            icon={Package}
            title="لا طلبات مطابقة ضمن الصفحات المحمّلة"
            description="قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل"
            action={
              <div className="flex justify-center gap-2 flex-wrap pt-1">
                <LoadMoreButton
                  /* R124-I4 (A4 F1): the fixed h-9 capped the button at
                     36px (it even capped Button's own min-h-8) — min-h-11
                     restores the 44px tap-target floor (twMerge drops the
                     sm variant's min-h-8). */
                  className="min-h-11 gap-1.5"
                  busy={loadingMoreOrders}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
                <button
                  onClick={() => setFilter("all")}
                  /* R122 (A1 P2-7): the text CTA was ~24px tall — min-h-11
                     rides the 44px tap-target floor. R124-I4 (A4 F1): the
                     load-more beside it lost its h-9 cap and rides the
                     same floor now (the old comment claimed it already
                     did). */
                  className="inline-flex items-center min-h-11 px-2 text-xs font-bold text-primary-text hover:underline"
                >
                  عرض كل الطلبات
                </button>
              </div>
            }
            className="reveal-up"
          />
        ) : (
          // Filter is active but matched nothing (and the whole list is
          // provably loaded — a single short page). Distinct from the
          // "no orders at all" empty state above — here the user has
          // orders, just none in the chosen bucket. Surface a quick
          // way to drop the filter without forcing them to find the
          // "all" chip again.
          //
          // R135 (FE-2): converged on the storefront EmptyState (the
          // hand-rolled twin this component canonized — identical
          // classes, strings and CTA); role="status" is net-new (R125
          // A6 B-8: the loading→empty swap was silent here).
          <EmptyState
            icon={Package}
            title="لا توجد طلبات في هذه الفئة"
            action={
              <button
                onClick={() => setFilter("all")}
                /* R122 (A1 P2-7): py-1.5 was ~30px tall — min-h-11 rides the
                   44px tap-target floor.
                   R125-I7 (A7 B-2): the hover tint rode raw text-primary
                   (3.76:1 on the dark card) — the text-safe token keeps the
                   hover state AA; hover:bg-primary/8 still carries the
                   hover feedback. */
                className="text-xs font-bold text-primary-text hover:text-primary-text border border-primary/22 px-4 min-h-11 rounded-xl hover:bg-primary/8 transition-colors press-spring"
              >
                عرض كل الطلبات
              </button>
            }
            className="reveal-up"
          />
        )
      ) : (
        /* Orders list */
        <div className="space-y-2.5">
          {visibleOrders.map((order, i: number) => {
            const staggerClass = STAGGER[Math.min(i, 12)] ?? "";
            // R165 (the R162 ADR §6.2): the cluster divider — rendered
            // ABOVE the run's first row only (presentational; every row
            // keeps its own identity/amount/status + link).
            const clusterRun = groupClusters.get(i);
            return (
              <div key={order.id} className="space-y-2">
                {clusterRun !== undefined && (
                  /* R166-A (F05): the wrapper carries NO aria-label —
                     aria-label on a role-less generic div is ignored
                     (and would hide the run count if honored); the
                     chip's own text carries the full information. */
                  <div className="flex items-center justify-center gap-1.5 pt-1">
                    <span className="flex items-center gap-1 text-2xs font-bold text-muted-foreground bg-muted/40 border border-border/35 rounded-full px-2.5 py-1">
                      <Layers className="w-3 h-3" />
                      عملية شراء واحدة
                      <span className="text-muted-foreground/80 tabular-nums">
                        (
                        {/* R166-A (F02 + F16): the run count is a standalone
                            parenthetical — the nominative dual «طلبان» via
                            the shared SUBJECT registry (was the oblique
                            «طلبين», contradicting the same page's header
                            chip). */}
                        {formatCount(clusterRun, ORDER_COUNT_FORMS_SUBJECT)})
                      </span>
                    </span>
                  </div>
                )}
                <Link href={`/orders/${order.order_code}`}>
                  <div
                    className={`
                  float-in ${staggerClass}
                  bg-card border border-border/60 border-r-[3px] ${statusAccentBorder(order.status)}
                  rounded-xl p-4
                  card-spring hover:border-border hover:shadow-xl
                  cursor-pointer group
                `}
                  >
                    {/* R139 (precision): the card's hand-rolled hover lift
                      (hover:-translate-y-0.5 + transition-all + the
                      active: overrides) is replaced by the family's
                      unified .card-spring — the exact ProductCard recipe
                      (one sanctioned spring: hover lift + active press,
                      border step + the calm neutral xl elevation;
                      R157-C retired the hover black/25 color override
                      for the bare themed hover:shadow-xl
                      (the theme ladder's .light step stays inside the
                      6–14% ceiling). The status accent edge + StatusBadge tokens
                      are untouched (pinned by order-refund-receipt). */}
                    <div className="flex items-center gap-3.5">
                      {/* Product image */}
                      <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
                        {order.product_image_url ? (
                          <img
                            src={order.product_image_url}
                            alt={order.product_name}
                            loading="lazy"
                            decoding="async"
                            /* R-140-a (image discipline): width/height
                             mirror the catalog art's measured 450×450
                             intrinsic (all 45 /products/*.webp, the
                             R132 L4-F9 census re-probed this round) —
                             the fixed w-12 h-12 well already pins CLS
                             at zero; the attrs keep the aspect-ratio
                             reserve honest pre-CSS. */
                            width={450}
                            height={450}
                            className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          /* R125-I7 (A7 B-6 class, computed): sibling of the
                           cart fallback — text-primary/50 measured
                           1.65:1 dark / 2.35:1 light on the muted/60
                           tile; full --muted-foreground: 7.44:1 / 6.09:1. */
                          <span className="text-xl font-bold text-muted-foreground select-none">
                            {(order.product_name ?? "؟")[0]}
                          </span>
                        )}
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        {/* R124-I4 (A5 #1): hover tint rides the text-safe
                          token — raw text-primary is 3.76:1 on the dark
                          card (AA fail on the hover state of small text). */}
                        {/* R143 (L3-2): dir="auto" + text-right — the
                          ProductCard F-1 recipe; order product names are
                          Latin by design and truncate from the wrong end
                          in an RTL block (the ellipsis eats the brand
                          head on the money-history surface). */}
                        <div
                          dir="auto"
                          className="font-bold text-sm leading-snug truncate text-right group-hover:text-primary-text transition-colors duration-150"
                        >
                          {order.product_name}
                        </div>
                        {/* R116-S2 (P2): the purchased option under the product
                          name — the same chip idiom as cart.tsx (the
                          shopper's mental model of WHAT the line is, not just
                          which brand). Null for legacy pre-variant orders. */}
                        {order.variant_label && (
                          <div className="text-2xs font-semibold text-muted-foreground bg-muted/40 border border-border/35 rounded-full px-2 py-0.5 mt-0.5 inline-block leading-tight">
                            {order.variant_label}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            dir="ltr"
                            className="font-mono text-2xs bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded border border-border/30"
                          >
                            {order.order_code}
                          </span>
                          {order.created_at && (
                            <span className="text-2xs text-muted-foreground">
                              {formatDateShort(order.created_at)}
                            </span>
                          )}
                          {(order as { coupon_code?: string }).coupon_code && (
                            <span className="flex items-center gap-0.5 text-3xs font-bold text-status-success bg-status-success/10 border border-status-success/22 px-1.5 py-0.5 rounded-full">
                              <Tag className="w-2.5 h-2.5" />
                              <span dir="ltr">
                                {(order as { coupon_code?: string }).coupon_code}
                              </span>
                            </span>
                          )}
                          {/* R115-I1 (A8 P2-3c): the refund receipt on the row —
                            RefundService credits the FULL orders.amount
                            back to the wallet (terminal-state guarded), so
                            the amount IS available on the row. Info tone,
                            never error red: the money came back. */}
                          {order.status === "refunded" && (
                            <span className="flex items-center gap-0.5 text-3xs font-bold text-status-info bg-status-info/10 border border-status-info/22 px-1.5 py-0.5 rounded-full whitespace-nowrap tabular-nums">
                              <Undo2 className="w-2.5 h-2.5" />
                              استُرد {formatCurrency(order.amount)} إلى محفظتك
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right side */}
                      <div className="flex items-center gap-2 shrink-0 max-w-[42%] sm:max-w-none">
                        <div className="text-right min-w-0">
                          {((order as { discount_amount?: number }).discount_amount ?? 0) > 0 && (
                            <div className="text-3xs text-muted-foreground line-through tabular-nums">
                              {formatCurrency(
                                (order.amount ?? 0) +
                                  ((order as { discount_amount?: number }).discount_amount ?? 0),
                              )}
                            </div>
                          )}
                          <div className="font-bold text-sm tabular-nums">
                            {formatCurrency(order.amount)}
                          </div>
                          {/* R116: shared StatusBadge (STATUS_TONE)
                            replaces the deprecated statusColor() — 93-C7
                            follow-up; the status glyph stays a child. */}
                          <StatusBadge
                            variant={
                              STATUS_TONE[order.status as keyof typeof STATUS_TONE] ??
                              UNKNOWN_STATUS_TONE
                            }
                            size="sm"
                            className="mt-1 justify-end"
                          >
                            <StatusIcon status={order.status} />
                            <span>{statusLabel(order.status)}</span>
                          </StatusBadge>
                        </div>
                        <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary-text group-hover:translate-x-[-2px] transition-all duration-150 shrink-0" />
                      </div>
                    </div>
                  </div>
                </Link>
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
