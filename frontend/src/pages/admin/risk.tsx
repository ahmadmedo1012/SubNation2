/**
 * Admin risk events review queue (003-anomaly-detection, US2 P1 slice).
 *
 * Lists risk_events with filters by level + lookback window. Click a row
 * to drill into /admin/risk/events/:id. Uses the existing AdminLayout
 * for chrome and useAdminHeaders for auth.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// 93-C7 / C-UX2 (A12 B3): risk-level pills migrate from raw
// emerald/yellow/orange/red hues to the canonical StatusBadge on the
// --status-* tokens (low→success, medium→warning, high→low-stock —
// the orange token, critical→error).
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
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
import { AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./layout";
import { formatDate } from "@/lib/utils";

type RiskLevel = "low" | "medium" | "high" | "critical";

interface RiskEventRow {
  id: number;
  user_id: number | null;
  user_phone: string | null;
  user_email: string | null;
  event_type: string;
  score: number;
  level: RiskLevel;
  confidence: number;
  rule_fired: string[];
  action_taken: string;
  ip_address: string | null;
  created_at: string;
  shown_at: string | null;
}

interface ListResponse {
  events: RiskEventRow[];
  next_cursor: string | null;
}

interface DashboardResponse {
  window_hours: number;
  total: number;
  by_level: Record<RiskLevel, number>;
  unresolved: number;
  top_rules: Array<{ rule: string; count: number }>;
  pipeline: { enabled: boolean };
}

const LEVEL_META: Record<RiskLevel, { label: string; tone: StatusBadgeVariant }> = {
  low: { label: "منخفض", tone: "success" },
  medium: { label: "متوسط", tone: "warning" },
  high: { label: "عالي", tone: "low-stock" },
  critical: { label: "حرج", tone: "error" },
};

const FILTERS: { value: "all" | RiskLevel; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "critical", label: "حرج" },
  { value: "high", label: "عالي" },
  { value: "medium", label: "متوسط" },
  { value: "low", label: "منخفض" },
];

// Active filter-chip styling derived from the same status tokens as the
// row pills (93-C7 / C-UX2) — chip + badge can no longer disagree.
const TONE_CHIP: Record<StatusBadgeVariant, string> = {
  success: "bg-status-success/15 text-status-success border-status-success/40",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/40",
  error: "bg-status-error/15 text-status-error border-status-error/40",
  "low-stock": "bg-status-low-stock/15 text-status-low-stock border-status-low-stock/40",
  info: "bg-status-info/15 text-status-info border-status-info/40",
  purple: "bg-status-purple/15 text-status-purple border-status-purple/40",
  primary: "bg-primary/15 text-primary border-primary/40",
  neutral: "bg-muted/45 text-muted-foreground border-border/50",
};

export default function AdminRiskPage() {
  const headers = useAdminHeaders();
  const { adminToken, hasAdminPermission } = useAuth();
  const [filter, setFilter] = useState<"all" | RiskLevel>("all");

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
    queryKey: ["admin-risk-events", "load-more", { level: filter === "all" ? undefined : filter }],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filter !== "all") params.set("level", filter);
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
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-primary" />
              مراقبة المخاطر
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              أحداث الأمان والاحتيال المرصودة من خط أنابيب التسجيل (003-anomaly-detection)
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              dashboard.refetch();
            }}
            disabled={isFetching || dashboard.isFetching}
            className="gap-2"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetching || dashboard.isFetching ? "animate-spin" : ""}`}
            />
            تحديث
          </Button>
        </header>

        {/* Dashboard stats */}
        {dashboard.data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <DashCard
              label={`إجمالي ${dashboard.data.window_hours} ساعة`}
              value={String(dashboard.data.total)}
              hint={
                dashboard.data.pipeline.enabled
                  ? "خط الأنابيب مفعَّل"
                  : "خط الأنابيب معطَّل (RISK_PIPELINE_ENABLED=false)"
              }
              tone={dashboard.data.pipeline.enabled ? "ok" : "warn"}
            />
            <DashCard
              label="حرج"
              value={String(dashboard.data.by_level.critical ?? 0)}
              tone={(dashboard.data.by_level.critical ?? 0) > 0 ? "danger" : "ok"}
            />
            <DashCard
              label="عالي"
              value={String(dashboard.data.by_level.high ?? 0)}
              tone={(dashboard.data.by_level.high ?? 0) > 0 ? "warn" : "ok"}
            />
            <DashCard
              label="بدون تصنيف"
              value={String(dashboard.data.unresolved)}
              hint="لم تُصنَّف بعد"
              tone={dashboard.data.unresolved > 0 ? "warn" : "ok"}
            />
          </div>
        )}
        {dashboard.data && dashboard.data.top_rules.length > 0 && (
          <div className="border border-border/40 rounded-2xl bg-card/60 p-3">
            <div className="text-xs text-muted-foreground mb-2 font-bold">
              أكثر القواعد إطلاقاً (24 ساعة)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dashboard.data.top_rules.map((r) => (
                <span
                  key={r.rule}
                  className="text-2xs font-mono bg-muted/40 border border-border/40 rounded-lg px-2 py-1"
                >
                  {r.rule}
                  <span className="opacity-60 mr-1.5">×{r.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const active = f.value === filter;
            const tone = f.value === "all" ? null : LEVEL_META[f.value as RiskLevel];
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                /* R125-I4 (A6 B-10): the active chip was purely visual —
                   aria-pressed exposes the toggle state (the
                   orders/users/tickets chip-bar idiom). */
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  active
                    ? tone
                      ? TONE_CHIP[tone.tone]
                      : "bg-primary/15 text-primary-text border-primary/40"
                    : "bg-muted/30 border-border/30 hover:bg-muted/60"
                }`}
              >
                {f.label}
                <span className="opacity-70 mr-1.5">({counts[f.value]})</span>
              </button>
            );
          })}
        </div>

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
            {/* Canonical admin table chrome + horizontal scroll on mobile —
                previously a bespoke border-border/40 bg-card/60 card with
                no overflow handling (7 columns crushed at 375px). */}
            <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      {/* 96-F7 (R96 A6 #15 + #6): scope="col" for screen
                          readers; dates pinned to -u-nu-latn so engines
                          without ar-LY data never emit Arabic-Indic
                          numerals. */}
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        المستوى
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        النوع
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        المستخدم
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        القاعدة
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        النقاط
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        الإجراء
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        الوقت
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => {
                      const tone = LEVEL_META[e.level];
                      const userLabel =
                        e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
                      return (
                        <tr
                          key={e.id}
                          className={`relative border-t border-border/30 hover:bg-muted/20 transition-colors cursor-pointer ${
                            i % 2 !== 0 ? "bg-muted/5" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <StatusBadge variant={tone.tone} size="xs">
                              {tone.label}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">{e.event_type}</td>
                          <td className="px-4 py-2.5 text-xs">{userLabel}</td>
                          <td className="px-4 py-2.5 text-2xs text-muted-foreground">
                            {e.rule_fired.slice(0, 2).join(", ") || "—"}
                            {e.rule_fired.length > 2 && ` +${e.rule_fired.length - 2}`}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">{e.score}</td>
                          <td className="px-4 py-2.5 text-2xs text-muted-foreground">
                            {e.action_taken}
                          </td>
                          <td className="px-4 py-2.5 text-2xs text-muted-foreground whitespace-nowrap">
                            {/* R125-I4 (A3-10): the whole row navigates —
                                the date cell's anchor stretches over the
                                row (after:inset-0 against the relative
                                tr), so the drill-in target is the entire
                                row, not a small date link in the last
                                column. Real anchor semantics + keyboard
                                access stay (single tab stop per row, the
                                docblock's "click a row" is finally true
                                on desktop). */}
                            <Link
                              href={`/admin/risk/events/${e.id}`}
                              aria-label={`فتح تحقيق الحدث رقم ${e.id}`}
                              className="text-primary-text hover:underline after:absolute after:inset-0 after:content-['']"
                            >
                              {formatDate(e.created_at)}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Mobile card list (parity with orders/users pattern) */}
            <div className="md:hidden space-y-2.5">
              {events.map((e) => {
                const tone = LEVEL_META[e.level];
                const userLabel =
                  e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
                return (
                  <Link key={e.id} href={`/admin/risk/events/${e.id}`}>
                    <div className="bg-card border border-border/60 rounded-2xl p-4 hover:border-primary/30 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <StatusBadge variant={tone.tone} size="xs">
                          {tone.label}
                        </StatusBadge>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {e.score} نقطة
                        </span>
                      </div>
                      <div className="font-mono text-xs font-bold mb-1">{e.event_type}</div>
                      <div className="text-xs text-muted-foreground mb-2">{userLabel}</div>
                      <div className="flex items-center justify-between text-2xs text-muted-foreground border-t border-border/30 pt-2">
                        <span>{e.action_taken}</span>
                        <span>{formatDate(e.created_at)}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

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

function DashCard({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const tones = {
    ok: "border-border/40 bg-card/60",
    warn: "border-amber-500/30 bg-amber-500/5",
    danger: "border-red-500/30 bg-red-500/5",
  };
  const valueColor = {
    ok: "",
    warn: "text-amber-400",
    danger: "text-red-400",
  };
  return (
    <div className={`border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-3xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${valueColor[tone]}`}>{value}</div>
      {hint && <div className="text-3xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
