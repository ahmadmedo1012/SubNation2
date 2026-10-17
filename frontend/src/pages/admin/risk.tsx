/**
 * Admin risk events review queue (003-anomaly-detection, US2 P1 slice).
 *
 * Lists risk_events with filters by level + lookback window. Click a row
 * to drill into /admin/risk/events/:id. Uses the existing AdminLayout
 * for chrome and useAdminHeaders for auth.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { EmptyState } from "@/components/admin/EmptyState";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// R123 (E3 item 1 + P3g): the three raw fetches ride the session-aware
// adminFetchJson wrapper (ok-guard + safe error-body parse + the global
// 401 toast/redirect on expiry), and all three queries gain
// `enabled: !!adminToken` — every other admin poller already gates on
// the token, so a logged-out render of this page (post-redirect flash)
// fired unauthenticated 401s into the console.
import { adminFetchJson } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
// R123 (E3 P3a): two-way URL sync — useSearch re-renders on ?sort=
// changes (the orders.tsx ?sort=/?status= idiom).
import { useSearch } from "wouter";
import { AdminLayout } from "./layout";
// R137 (FE decomposition): the risk queue's presentational sections and
// pure metadata moved to @/components/admin/risk/* (verbatim moves — the
// query layer stays HERE: the 30s dashboard poller, the accumulating
// events infinite query (the next_cursor has-more envelope + the
// load-more queue action), the background unfiltered counter query, the
// filter atom and the level-agnostic counts memo; the extracts render
// the byte-identical DOM they rendered inline yesterday). Import surface:
//   • risk-meta — the pure module (the RiskLevel/row/response contracts,
//     LEVEL_META, FILTERS, TONE_CHIP)
//   • RiskHeader — h1 + the both-queries «تحديث» refresh CTA
//   • RiskDashboardPanel — the R133 triad + the four tiles + top-rules
//     (DashCard is its nested consumer)
//   • RiskFilterChips — the aria-pressed level chip bar with counts
//   • RiskEventsTable — the desktop sticky-glass fraud table
//   • RiskEventsMobileList — the mobile drill-in card list
import {
  type DashboardResponse,
  isRiskSort,
  type ListResponse,
  type RiskLevel,
} from "@/components/admin/risk/risk-meta";
import { RiskHeader } from "@/components/admin/risk/RiskHeader";
import { RiskDashboardPanel } from "@/components/admin/risk/RiskDashboardPanel";
import { RiskFilterChips } from "@/components/admin/risk/RiskFilterChips";
import { RiskEventsTable } from "@/components/admin/risk/RiskEventsTable";
import { RiskEventsMobileList } from "@/components/admin/risk/RiskEventsMobileList";

export default function AdminRiskPage() {
  const headers = useAdminHeaders();
  const { adminToken, hasAdminPermission } = useAuth();
  const [filter, setFilter] = useState<"all" | RiskLevel>("all");
  // R160 (risk sort affordance): the SERVER-side ?sort= state — the
  // queue is CURSOR-paginated, so unlike the coupons console's
  // client-side sort the ordering rides the query key (a flip changes
  // the key → the accumulating list restarts at page 1 under the new
  // ordering, and the cursor never crosses sorts). Same two-way ?sort=
  // sync discipline as the users/orders directories; invalid deep-link
  // values degrade to the default ("" → no param).
  const [sortBy, setSortBy] = useState(() => {
    const s = new URLSearchParams(window.location.search).get("sort") ?? "";
    return isRiskSort(s) ? s : "";
  });
  // R123 (E3 P3a): the URL is the second source of truth (see the
  // sync effect below).
  const searchParam = useSearch();

  // R125-I4 (A3-11): honest-reason RBAC gate (the settings.tsx
  // tabAllowed idiom). The nav hides /admin/risk from admins without
  // the users scope (layout.tsx NAV_SECTIONS), but a deep link used
  // to mount the page, fire the queries, and land on a generic
  // «فشل تحميل» banner. A scope-less admin now sees the honest
  // reason up front and fires nothing.
  const canViewRisk = hasAdminPermission("users");

  const dashboard = useQuery<DashboardResponse>({
    queryKey: ["admin-risk-dashboard"],
    queryFn: async () =>
      adminFetchJson<DashboardResponse>(`/api/admin/risk/dashboard?hours=24`, { headers }),
    refetchInterval: 30_000,
    // 96-F7 (R96 M11): 30s polling must pause when the tab is hidden —
    // an idle risk-monitor tab on a phone burned 2 requests/minute on
    // mobile data. Every other admin poller (orders/products/alerts)
    // already sets this to false.
    refetchIntervalInBackground: false,
    // R123 (E3 P3g): no token ⇒ no fetch (see header comment). R125-I4
    // (A3-11): no users scope ⇒ no fetch either.
    enabled: !!adminToken && canViewRisk,
  });

  // R125-I4 (A4-B-6): the events list rides the backend's real
  // has-more envelope — the response carries next_cursor (the
  // limit+1 probe verdict), and the accumulating useInfiniteQuery
  // appends the next cursor page in place (the orders/users/tickets
  // recipe). The old fixed limit=100 query ignored the envelope, so
  // events #101+ were unreachable no matter what the filter said.
  // The "load-more" key segment mirrors those pages: it keeps the
  // infinite cache entry from colliding with the plain all-window
  // query below (the shared-key dedupe it replaces).
  const {
    data: eventsPages,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery<ListResponse, Error>({
    // R160: the validated sort rides the query key — a flip restarts
    // the cursor list at page 1 (the key change drops the stale pages,
    // so a created_at cursor can never leak into a score-ordered
    // request).
    queryKey: [
      "admin-risk-events",
      "load-more",
      {
        level: filter === "all" ? undefined : filter,
        sort: isRiskSort(sortBy) ? sortBy : undefined,
      },
    ],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filter !== "all") params.set("level", filter);
      if (isRiskSort(sortBy)) params.set("sort", sortBy);
      const cursor = pageParam as string | null;
      if (cursor) params.set("cursor", cursor);
      return adminFetchJson<ListResponse>(`/api/admin/risk/events?${params.toString()}`, {
        headers,
        signal,
      });
    },
    initialPageParam: null as string | null,
    // Frozen envelope contract (backend risk.ts:193-196): next_cursor
    // is non-null exactly when the limit+1 probe found another row —
    // it IS the has-more verdict.
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: !!adminToken && canViewRisk,
  });

  // 94-C2 (A2 P3-1): the chip counters were computed from the FILTERED
  // response — picking «حرج» made every other chip read (0) even when
  // high/medium events existed (the server only returned the filtered
  // subset). The counters need a level-agnostic source:
  //   - filter === "all": the main view IS the all-view — its
  //     accumulated pages feed the counters directly (and grow with
  //     load-more). R125-I4: this replaces the old shared-key dedupe
  //     with the infinite query (whose cache shape no longer matches
  //     a plain useQuery entry).
  //   - filter !== "all": a background plain query fetches the
  //     unfiltered window (same as before).
  const allEventsQuery = useQuery<ListResponse>({
    queryKey: ["admin-risk-events", "all"],
    queryFn: async () =>
      adminFetchJson<ListResponse>(`/api/admin/risk/events?limit=100`, { headers }),
    enabled: !!adminToken && canViewRisk && filter !== "all",
  });

  const events = useMemo(() => (eventsPages?.pages ?? []).flatMap((p) => p.events), [eventsPages]);
  const countSource = filter === "all" ? events : (allEventsQuery.data?.events ?? events);
  const counts = useMemo(() => {
    const c: Record<RiskLevel | "all", number> = {
      all: countSource.length,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const e of countSource) c[e.level]++;
    return c;
  }, [countSource]);

  // R123 (E3 P3a): URL → sort (a ?sort= change lands without clobbering
  // a sort the operator already picked locally — the orders.tsx
  // contract). An invalid value degrades to the default ordering
  // instead of reaching the server as a 400.
  useEffect(() => {
    const q = new URLSearchParams(searchParam);
    const s = q.get("sort") ?? "";
    const sort = isRiskSort(s) ? s : "";
    setSortBy((prev) => (prev === sort ? prev : sort));
  }, [searchParam]);

  // R160: sort flips write ?sort= back via replaceState (the same
  // discipline — the extracts call THIS handler, never the raw setter,
  // so the URL cannot desync from the headers/chips).
  const handleSortBy = (value: string) => {
    setSortBy(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("sort", value);
    else url.searchParams.delete("sort");
    window.history.replaceState(null, "", url.toString());
  };

  // R125-I4 (A3-11): the deep-link honest-reason card (the settings.tsx
  // tabAllowed idiom) — reached only via a URL, never via the nav (which
  // hides the item for scope-less admins). Sits AFTER every hook (the
  // queries' `enabled` gates already keep a scope-less mount fetch-free).
  // The status-warning token keeps AA contrast in both themes.
  if (!canViewRisk) {
    return (
      <AdminLayout>
        <p className="text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
          مراقبة المخاطر تتطلب صلاحية المستخدمين — تواصل مع مسؤول النظام
        </p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <RiskHeader
          onRefresh={() => {
            refetch();
            dashboard.refetch();
          }}
          refreshing={isFetching || dashboard.isFetching}
        />

        <RiskDashboardPanel
          isPending={dashboard.isPending}
          isError={dashboard.isError}
          data={dashboard.data}
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
        />

        <RiskFilterChips filter={filter} counts={counts} onFilterChange={setFilter} />

        {/* Empty / loading / error / list — R125-I4 (A3-2): an error
            is an error and ONLY an error. The old layout rendered the
            failure banner AND the «لا توجد أحداث» EmptyState together
            (on a failed load events is [] and isLoading is false), so
            an operator skimming past the banner read "no fraud
            events" during an outage — the B5-04 contract, fixed with
            the tickets.tsx error-card recipe + an inline retry. */}
        {isLoading && (
          <TableSkeleton
            cells={["w-20 rounded-full", "flex-1", "w-24", "flex-1", "w-14", "w-20", "w-28"]}
          />
        )}
        {isError && events.length === 0 && (
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل الأحداث"
            description={`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`}
            onRetry={() => void refetch()}
          />
        )}
        {/* A refresh of an already-rendered list failed — keep the
            accumulated rows, surface the failure inline (the
            stale-refresh banner idiom every sibling list uses). */}
        {isError && events.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="min-w-0">تعذّر تحديث الأحداث</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {!isLoading && !isError && events.length === 0 && (
          <EmptyState
            icon={ShieldCheck}
            title="لا توجد أحداث في النطاق المحدد"
            description="لتفعيل خط الأنابيب: اضبط RISK_PIPELINE_ENABLED=true في الخادم ثم انتظر معالجة طلبات الدخول والشحن."
          />
        )}
        {events.length > 0 && (
          <>
            <RiskEventsTable events={events} sortBy={sortBy} onSortBy={handleSortBy} />
            <RiskEventsMobileList events={events} sortBy={sortBy} onSelectSort={handleSortBy} />

            {/* R125-I4 (A4-B-6): the has-more envelope drives a real
                append-in-place «تحميل المزيد» (the orders/users/tickets
                recipe) — the button replaces the old "newest 100 only"
                truncation notice and hides when next_cursor goes null. */}
            {hasNextPage && (
              <div className="flex justify-center pt-1">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
