import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCount, formatRelativeTime } from "@/lib/utils";
import { TYPE_CONFIG } from "@/components/layout/NotificationBell";
import { CheckCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useSeo } from "@/hooks/useSeo";

/**
 * A9-F2 (R128-IMP-5 / B1 item 8): the full notifications page.
 *
 * The bell panel is a 40-row window onto the newest notifications and
 * (A9-2 / R126-L6) honestly says «آخر 40 إشعاراً» at the cap — but a
 * user with history had no way to reach row #41+. The backend grew the
 * additive `?page=` envelope (routes/notifications.ts — the audit-logs
 * idiom: clamps, total, hasMore, id-DESC tiebreaker); this page is its
 * frontend consumer.
 *
 * Shape decisions (each mirrors an established page):
 *   • the accumulating useInfiniteQuery + raw-URL fetch — orders.tsx's
 *     R120-B7 idiom (the generated client can't express `?page=` yet);
 *   • row presentation rides the bell's TYPE_CONFIG (same icons, same
 *     --status-* tokens, same action chips) so the page reads as the
 *     same surface as the panel, widened to page rows;
 *   • mark-read is the bell's optimistic + rollback contract (no toast:
 *     the next poll/refetch reconciles silently);
 *   • the count badge can state the TRUE total — the paged envelope
 *     carries it (unlike the orders plain-array contract) — «عرض X من
 *     Y» until every page is loaded;
 *   • guests redirect through the guarded-page convention (orders.tsx).
 */

/** Matches the backend paged branch's default (routes/notifications.ts
 * DEFAULT_PAGE_LIMIT) so a short page really means the end. */
const NOTIFICATIONS_PAGE_SIZE = 20;

const NOTIFICATION_COUNT_FORMS = {
  one: "إشعار",
  two: "إشعاران",
  few: "إشعارات",
  many: "إشعاراً",
  other: "إشعار",
} as const;

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

/** The paged envelope (GET /api/notifications?page=N). */
interface NotificationsPage {
  notifications: NotificationRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export default function NotificationsPage() {
  // User-private surface — never indexed (also in NOINDEX_ROUTES, which
  // stamps the fallback robots directive; this block owns the title).
  const seoBlock = useSeo({
    title: "الإشعارات — SubNation",
    description: "كل تنبيهاتك — الطلبات، المحفظة، الدعم ونقاط الولاء — في مكان واحد.",
    path: "/notifications",
    robots: "noindex,follow",
  });

  const { token } = useAuth();
  const [, navigate] = useLocation();

  const {
    data: pages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingMore,
  } = useInfiniteQuery<NotificationsPage, Error>({
    queryKey: ["/api/notifications", "paged"],
    queryFn: async ({ pageParam, signal }) => {
      const r = await fetch(
        `/api/notifications?page=${pageParam as number}&limit=${NOTIFICATIONS_PAGE_SIZE}`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
          signal,
        },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `تعذّر تحميل الإشعارات (HTTP ${r.status})`);
      }
      const d = await r.json();
      // Shape guard (the raw-fetch hardening idiom): only a well-formed
      // envelope reaches the cache.
      if (!d || !Array.isArray((d as NotificationsPage).notifications)) {
        throw new Error("تعذّر تحميل الإشعارات");
      }
      return d as NotificationsPage;
    },
    initialPageParam: 1,
    // The envelope's honest flag (unlike the orders plain-array contract,
    // the server TELLS us whether a next page exists).
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    enabled: !!token,
  });

  // Accumulated list — dedup by id (orders.tsx idiom): a notification
  // landing between page requests shifts offset boundaries, so a row can
  // legitimately repeat across pages.
  const rows = useMemo(() => {
    const seen = new Set<number>();
    const acc: NotificationRow[] = [];
    for (const page of pages?.pages ?? []) {
      for (const n of page.notifications) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        acc.push(n);
      }
    }
    return acc;
  }, [pages]);

  // The freshest page's total (each page re-counts; the last one is the
  // most current — a notification created mid-browse bumps it).
  const total = pages?.pages.at(-1)?.total ?? 0;

  // Bell-style read-state overlay: optimistic flips on the accumulated
  // rows, exact rollback on failure, reconciled by any later refetch
  // (the POST already persisted server-side).
  const [readOverlay, setReadOverlay] = useState<Set<number>>(new Set());
  const unread = useMemo(
    () => rows.filter((n) => !n.is_read && !readOverlay.has(n.id)).length,
    [rows, readOverlay],
  );

  const markRead = useCallback(
    async (id: number) => {
      if (!token || readOverlay.has(id)) return;
      setReadOverlay((prev) => new Set(prev).add(id));
      try {
        const r = await fetch(`/api/notifications/${id}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch {
        // Rollback — the bell's silent-reconcile contract (no toast; the
        // next poll / refetch carries the server truth).
        setReadOverlay((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [token, readOverlay],
  );

  const markAllRead = useCallback(async () => {
    if (!token || unread === 0) return;
    const snapshot = readOverlay;
    setReadOverlay(new Set(rows.filter((n) => !n.is_read).map((n) => n.id)));
    try {
      const r = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      setReadOverlay(snapshot);
    }
  }, [token, unread, readOverlay, rows]);

  const openNotification = useCallback(
    (n: NotificationRow, href: string) => {
      void markRead(n.id);
      navigate(href);
    },
    [markRead, navigate],
  );

  // The guarded-page convention (orders.tsx): the bell only exists for
  // authed sessions, so a guest here is a direct-URL arrival — route it
  // through login with the return path. The path is read INSIDE the
  // effect (orders.tsx:278 idiom) so the redirect can't re-fire itself.
  useEffect(() => {
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
  }, [token, navigate]);
  if (!token) return <RouteSkeleton shape="list" />;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {seoBlock}
      {/* Header — the page-header idiom (orders.tsx): icon tile, h1,
          subline, count badge. */}
      <div className="flex items-center justify-between gap-3 mb-7 page-in flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
            <CheckCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            {/* R128 (A4-F3): the Arabic-safe 1.3 leading floor — the
                storefront-r128 sweep guards every h1-h4 against
                leading-tight (diacritics/ascenders clip at 1.25). */}
            <h1 className="text-2xl font-bold">الإشعارات</h1>
            <p className="text-sm text-muted-foreground">
              تنبيهات الطلبات والمحفظة والدعم في مكان واحد
            </p>
          </div>
        </div>
        {!isLoading && rows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-bold text-muted-foreground bg-card border border-border/60 px-3 py-1.5 rounded-full shadow-sm shrink-0">
              {/* The paged envelope carries the TRUE total (unlike the
                  orders plain-array contract) — «عرض X من Y» until the
                  last page lands, then the plain count. */}
              {rows.length < total
                ? `عرض ${formatCount(rows.length, NOTIFICATION_COUNT_FORMS)} من ${formatCount(
                    total,
                    NOTIFICATION_COUNT_FORMS,
                  )}`
                : formatCount(total, NOTIFICATION_COUNT_FORMS)}
            </div>
            {unread > 0 && (
              <Button
                variant="ghost"
                onClick={() => void markAllRead()}
                className="min-h-11 text-muted-foreground hover:text-foreground font-bold gap-1.5"
              >
                <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                تحديد الكل كمقروء
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl skeleton-shimmer border border-border/35" />
          ))}
        </div>
      ) : isError ? (
        /* Distinct from "no notifications": an outage must never read as
           an empty history (the 93-C5 / F-05 class). */
        <FetchErrorCard
          size="page"
          className="py-20 reveal-up"
          title="تعذّر تحميل الإشعارات"
          description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
          retryClassName="min-h-11 gap-2"
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-2xl bg-primary/6 blur-xl" />
            <div className="relative w-20 h-20 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center">
              <CheckCheck className="w-9 h-9 opacity-25" aria-hidden="true" />
            </div>
          </div>
          <p className="font-bold text-lg mb-1.5 text-foreground/80">لا توجد إشعارات</p>
          <p className="text-sm text-muted-foreground mb-7 max-w-xs mx-auto leading-relaxed">
            ستظهر هنا تنبيهات طلباتك وشحن محفظتك وردود الدعم
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((n, i) => {
            const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
            const IconComp = cfg.icon;
            const ActionIconComp = cfg.actionIcon;
            const actionHref = n.link ?? cfg.actionHref;
            const isRead = n.is_read || readOverlay.has(n.id);
            return (
              <div
                key={n.id}
                className={`float-in stagger-${Math.min(i, 8)} relative bg-card border ${
                  isRead ? "border-border/50" : "border-primary/25 bg-primary/[0.03]"
                } rounded-2xl px-4 py-3.5 transition-colors`}
              >
                {!isRead && (
                  /* The bell's unread language: 1px inline-start stripe
                     (R124-A3 #12 refuse rule) + the row tint. */
                  <div className="absolute right-0 top-3 bottom-3 w-px bg-primary/60 rounded-full" />
                )}
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => actionHref && openNotification(n, actionHref)}
                    className="flex items-start gap-3 text-start flex-1 min-w-0 cursor-pointer hover:opacity-85 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl -m-1 p-1"
                    aria-label={`${n.title}${actionHref ? " — افتح" : ""}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${cfg.bg} ${cfg.border}`}
                    >
                      <IconComp className={`w-3.5 h-3.5 ${cfg.color}`} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm font-semibold leading-snug break-words ${
                            isRead ? "text-foreground/75" : "text-foreground"
                          }`}
                        >
                          {n.title}
                        </p>
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5 badge-pulse" />
                        )}
                      </div>
                      {n.message && (
                        /* A4-F1 cousin (NotificationBell.tsx:618 family):
                           user-content line-clamp carries dir=auto so a
                           Latin-first message truncates from its own end. */
                        <p
                          dir="auto"
                          className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed"
                        >
                          {n.message}
                        </p>
                      )}
                      <p className="text-3xs text-muted-foreground mt-1.5 font-semibold">
                        {formatRelativeTime(n.created_at)}
                      </p>
                    </div>
                  </button>
                </div>
                {(actionHref || !isRead) && (
                  <div className="flex items-center gap-2 mt-2 mr-11">
                    {actionHref && cfg.actionLabel && (
                      <button
                        type="button"
                        onClick={() => actionHref && openNotification(n, actionHref)}
                        className={`flex min-h-11 items-center gap-1.5 text-2xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-150 hover:opacity-80 active:scale-95 ${cfg.bg} ${cfg.border} ${cfg.color}`}
                      >
                        {cfg.actionLabel}
                        {ActionIconComp && (
                          <ActionIconComp className="w-3 h-3" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {!isRead && (
                      <button
                        type="button"
                        onClick={() => void markRead(n.id)}
                        className="flex min-h-11 items-center gap-1 text-2xs text-muted-foreground hover:text-muted-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/40 transition-all duration-150"
                      >
                        <CheckCheck className="w-2.5 h-2.5" aria-hidden="true" />
                        تحديد كمقروء
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* «تحميل المزيد» — the LoadMoreButton family (orders.tsx),
              gated on the envelope's honest hasMore. */}
          {hasNextPage && (
            <div className="flex justify-center pt-3">
              <LoadMoreButton
                size="default"
                className="min-h-11 gap-1.5"
                iconClassName="w-4 h-4"
                busy={loadingMore}
                disabled={isLoading}
                onClick={() => void fetchNextPage()}
              />
            </div>
          )}
        </div>
      )}

      {/* Bottom safe area */}
      <div className="h-6 md:h-0" />
    </div>
  );
}
