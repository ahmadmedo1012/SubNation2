import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCount, formatCurrency, formatDateShort, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { type Order } from "@workspace/api-client-react";
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

const FILTER_TONES: Record<
  "neutral" | "info" | "warning" | "success" | "error",
  { active: string; idle: string }
> = {
  neutral: {
    active: "bg-foreground text-background border-foreground shadow-sm shadow-black/20",
    idle: "bg-muted/40 border-border/55 text-muted-foreground hover:text-foreground hover:bg-muted/60",
  },
  // R116-S2 (P3): the refunded/failed bucket rides the INFO tone — a
  // refund is not a failure (the money came back; the pill + row accent
  // already carry status-info). Pure «فشل» red mislabeled every
  // refunded order in the list.
  info: {
    active:
      "bg-status-info/15 border-status-info/45 text-status-info shadow-sm shadow-status-info/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-info hover:border-status-info/35",
  },
  warning: {
    active:
      "bg-status-warning/15 border-status-warning/45 text-status-warning shadow-sm shadow-status-warning/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-warning hover:border-status-warning/35",
  },
  success: {
    active:
      "bg-status-success/15 border-status-success/45 text-status-success shadow-sm shadow-status-success/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-success hover:border-status-success/35",
  },
  error: {
    active:
      "bg-status-error/15 border-status-error/45 text-status-error shadow-sm shadow-status-error/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-error hover:border-status-error/35",
  },
};

function FilterChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Clock;
  label: string;
  count: number;
  tone: "neutral" | "info" | "warning" | "success" | "error";
}) {
  const styles = FILTER_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      /* R116-S2 (P2/P3): 44px touch floor on the filter chips (was
         ~30px — a mis-tap while scrolling the list dropped a filter
         silently). */
      className={`flex items-center gap-1.5 min-h-11 text-xs font-bold border px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 transition-all duration-150 press-spring ${
        active ? styles.active : styles.idle
      }`}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
      <span className={`tabular-nums font-bold ${active ? "" : "opacity-60"}`}>{count}</span>
    </button>
  );
}

function OrderCardSkeleton() {
  return (
    /* R125-I7 (A7 B-12 / R124-A3 #12): the skeleton row rode a 2px
       border-r accent stripe — the craft-floor cap for colored side
       stripes is 1px (the plain border already provides the edge). */
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-muted skeleton-shimmer shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
          <div className="flex gap-2">
            <div className="h-3 bg-muted skeleton-shimmer rounded w-24" />
            <div className="h-3 bg-muted skeleton-shimmer rounded w-20" />
          </div>
        </div>
        <div className="shrink-0 space-y-1.5 text-right">
          <div className="h-4 bg-muted skeleton-shimmer rounded w-16" />
          <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
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
      const r = await fetch(`/api/orders?page=${pageParam as number}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        signal,
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `تعذّر تحميل الطلبات (HTTP ${r.status})`);
      }
      const d = await r.json();
      return Array.isArray(d) ? (d as Order[]) : [];
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
  const pending = orders.filter((o) => o.status === "pending");
  const completed = orders.filter((o) => o.status === "completed");
  const failed = orders.filter((o) => o.status === "failed" || o.status === "refunded");

  // Apply the active filter chip. The "all" chip preserves the
  // existing default behaviour (every order, sorted by the API).
  const visibleOrders = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "pending") return pending;
    if (filter === "completed") return completed;
    return failed;
  }, [filter, orders, pending, completed, failed]);

  // R122 (A1-P2): guests get the list-shaped RouteSkeleton instead of
  // a bare null — checkout.tsx's R115-I1 guard (the white frame between
  // the lazy-skeleton swap-out and the redirect tick read as a blank
  // page on slow links). Same "list" shape ROUTE_SHAPES maps /orders to.
  if (!token) return <RouteSkeleton shape="list" />;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-7 page-in flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
            <ShoppingBag className="w-5 h-5 text-primary" />
          </div>
          <div>
            {/* R128-A4 (F-3): leading-tight removed — the base h1–h4 1.3
                Arabic-safe floor (index.css) owns the leading. */}
            <h1 className="text-2xl font-bold">طلباتي</h1>
            <p className="text-sm text-muted-foreground">سجل مشترياتك ومتابعة حالتها</p>
          </div>
        </div>
        {!isLoading && orders.length > 0 && (
          <div className="text-sm font-bold text-muted-foreground bg-card border border-border/60 px-3 py-1.5 rounded-full shadow-sm shrink-0">
            {/* R94-A1 #11 (P3): Arabic pluralization via the shared
                formatCount (طلبان / طلبات / طلباً) instead of a frozen
                singular «طلب» after every count. R120-B7 (A6-F1): once a
                second page may exist the count is what the list SHOWS
                («عرض N (الأحدث أولاً)», admin/orders.tsx honesty idiom),
                never a grand total the plain-array contract can't know. */}
            {knownTotal
              ? formatCount(orders.length, {
                  one: "طلب",
                  two: "طلبان",
                  few: "طلبات",
                  many: "طلباً",
                  other: "طلب",
                })
              : `عرض ${formatCount(orders.length, {
                  one: "طلب",
                  two: "طلبان",
                  few: "طلبات",
                  many: "طلباً",
                  other: "طلب",
                })} (الأحدث أولاً)`}
          </div>
        )}
      </div>

      {/* Filter chips. The "all" chip acts as a reset — only shown
          once there are at least two non-empty buckets, so a fresh
          user with one pending order doesn't see redundant filtering
          UI. Each tone-specific chip lights up when active using its
          status token; inactive chips are muted and unclickable when
          their bucket is empty. */}
      {!isLoading && orders.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap slide-up overflow-x-auto scrollbar-none">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={Layers}
            label="الكل"
            count={orders.length}
            tone="neutral"
          />
          {pending.length > 0 && (
            <FilterChip
              active={filter === "pending"}
              onClick={() => setFilter("pending")}
              icon={Clock}
              label="قيد الانتظار"
              count={pending.length}
              tone="warning"
            />
          )}
          {completed.length > 0 && (
            <FilterChip
              active={filter === "completed"}
              onClick={() => setFilter("completed")}
              icon={CheckCircle}
              label="مكتمل"
              count={completed.length}
              tone="success"
            />
          )}
          {failed.length > 0 && (
            <FilterChip
              active={filter === "failed"}
              onClick={() => setFilter("failed")}
              icon={Undo2}
              /* R116-S2 (P3): «مُسترد» leads — most rows in this bucket are
                 refunds (the money came back), not failures; info tone
                 matches the row pill/accent (R115-I1 A8 P2-3). */
              label="مُسترد / فشل"
              count={failed.length}
              tone="info"
            />
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
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
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-2xl bg-primary/6 blur-xl" />
            <div className="relative w-20 h-20 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center">
              <Package className="w-9 h-9 opacity-25" />
            </div>
          </div>
          <p className="font-bold text-lg mb-1.5 text-foreground/80">لا توجد طلبات بعد</p>
          <p className="text-sm text-muted-foreground mb-7 max-w-xs mx-auto leading-relaxed">
            ابدأ بتصفح الكتالوج واشترِ أول اشتراك رقمي
          </p>
          {/* R120-B7 (reviewer finding — A4-F1 sweep completion): asChild
              composition (cart.tsx ghost-CTA idiom) instead of Link>Button
              nesting — one anchor, one tab stop, identical styling. */}
          <Button asChild className="min-h-11 gap-2">
            <Link href="/">
              <Sparkles className="w-4 h-4" />
              تصفح الكتالوج
            </Link>
          </Button>
        </div>
      ) : visibleOrders.length === 0 ? (
        hasNextPage ? (
          /* R120-B7 (A6-F1, admin/orders.tsx R115 A9 P2 pattern): the
             filter chips run CLIENT-SIDE over the accumulated pages, so
             an active bucket can read «لا توجد طلبات» while matching
             rows sit on unloaded pages (hasNextPage=true). The hard
             empty state was a false claim; keep the load-more visible
             + the honest incompleteness hint instead. */
          <div className="text-center py-12 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto flex items-center justify-center">
              <Package className="w-5 h-5 opacity-35" />
            </div>
            <p className="font-bold text-sm text-foreground/85">
              لا طلبات مطابقة ضمن الصفحات المحمّلة
            </p>
            <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل</p>
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
          </div>
        ) : (
          // Filter is active but matched nothing (and the whole list is
          // provably loaded — a single short page). Distinct from the
          // "no orders at all" empty state above — here the user has
          // orders, just none in the chosen bucket. Surface a quick
          // way to drop the filter without forcing them to find the
          // "all" chip again.
          <div className="text-center py-12 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
            <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center">
              <Package className="w-5 h-5 opacity-35" />
            </div>
            <p className="font-bold text-sm mb-3 text-foreground/85">لا توجد طلبات في هذه الفئة</p>
            <button
              onClick={() => setFilter("all")}
              /* R122 (A1 P2-7): py-1.5 was ~30px tall — min-h-11 rides the
                 44px tap-target floor.
                 R125-I7 (A7 B-2): the hover tint rode raw text-primary
                 (3.76:1 on the dark card) — the text-safe token keeps
                 the hover state AA; hover:bg-primary/8 still carries the
                 hover feedback. */
              className="text-xs font-bold text-primary-text hover:text-primary-text border border-primary/22 px-4 min-h-11 rounded-xl hover:bg-primary/8 transition-colors press-spring"
            >
              عرض كل الطلبات
            </button>
          </div>
        )
      ) : (
        /* Orders list */
        <div className="space-y-2.5">
          {visibleOrders.map((order, i: number) => {
            const staggerClass = STAGGER[Math.min(i, 12)] ?? "";
            return (
              <Link key={order.id} href={`/orders/${order.order_code}`}>
                <div
                  className={`
                  float-in ${staggerClass}
                  bg-card border border-border/60 border-r-[3px] ${statusAccentBorder(order.status)}
                  rounded-xl p-4
                  hover:border-border hover:shadow-xl hover:shadow-black/20 hover:-translate-y-0.5
                  transition-all duration-200 cursor-pointer group active:scale-[0.995] active:translate-y-0
                `}
                >
                  <div className="flex items-center gap-3.5">
                    {/* Product image */}
                    <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
                      {order.product_image_url ? (
                        <img
                          src={order.product_image_url}
                          alt={order.product_name}
                          loading="lazy"
                          decoding="async"
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
                      <div className="font-bold text-sm leading-snug truncate group-hover:text-primary-text transition-colors duration-150">
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
                            <span dir="ltr">{(order as { coupon_code?: string }).coupon_code}</span>
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
                      <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-[-2px] transition-all duration-150 shrink-0" />
                    </div>
                  </div>
                </div>
              </Link>
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
