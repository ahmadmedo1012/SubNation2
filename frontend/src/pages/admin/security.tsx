import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/Skeleton";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled bare "لا توجد أنشطة" empty
// state adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { useAuth } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { getErrorMessage } from "@/lib/errors";
// R126-L8b (A4 §C batch-C): both reads ride the generated client from
// the batch-1 spec exposure — useGetAdminAuthStatsSummary (stats cards)
// and useListAdminAuthActivity (timeline, keyed by the filter params).
// The R125-I5 seq/abort belt is now TanStack-native: the params sit in
// the queryKey, so a filter flip swaps queries and the stale response
// can only land in the OLD key's cache — last-REQUEST wins. customFetch
// owns the ok-guard + the global 401 observer (useAdminHeaders
// registers it), so a session expiring mid-work still gets the
// «انتهت الجلسة» toast + redirect; the error cards below stay quiet on
// its ApiError shape (the A4 §C batch-A idiom: `err.status === 401`).
// R127-L5 (B15-1): the new «إجراءات المسؤولين» tab rides the same
// generated-client pattern — useListAdminAuditLogs (the audit_logs
// reader exposed in this round's spec batch), finite page/limit
// pagination over the alerts-envelope contract.
import {
  useGetAdminAuthStatsSummary,
  useListAdminAuthActivity,
  useListAdminAuditLogs,
} from "@workspace/api-client-react";
import { Activity, Download, ScrollText, Shield, WifiOff } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
import { formatCount } from "@/lib/utils";
// R137 (FE decomposition): the page's presentational panes and pure
// label maps moved to @/components/admin/security/* (verbatim moves —
// the data path stays HERE: every state atom, all three queries with
// their keepPreviousData / last-request-wins keys, the refresh + CSV
// export actions, the audit pager atom and the tab coordination; the
// extracts render the byte-identical DOM they rendered inline
// yesterday). Import surface:
//   • security-meta — the page's pure module (the Arabic action/actor
//     label maps, the window/page-size constants, the plural forms,
//     the audit metadata formatter, the 401 session-expiry predicate
//     the quiet-catches duck-type; re-exports the generated row types
//     the extracts type their props with — type-only, no runtime api
//     surface)
//   • AuthPaneSkeleton — the auth pane's page-shaped first-load skeleton
//   • AuthStatsGrid — the four KPI cards (loaded tiles only)
//   • AuthFiltersCard — the auth timeline's action/success selects
//   • ActivityTimelineCard — the honest-count timeline + its error card
//   • AuditFiltersCard — the audit tab's action/actor/date-range inputs
//   • AuditTrailErrorCard / AuditTrailTable — the audit tab's failure
//     card and the loaded table + finite pager. The audit pane's
//     first-load SkeletonText branch stays HERE (the R136 UX-1 adoption
//     floor pins this page importing @/components/ui/Skeleton — the
//     1-a system.tsx precedent).
import {
  AUDIT_ACTOR_TYPE_LABELS,
  AUDIT_COUNT_FORMS,
  AUDIT_PAGE_SIZE,
  auditActionLabel,
  actionLabel,
  isSessionExpiredError,
} from "@/components/admin/security/security-meta";
import { AuthPaneSkeleton } from "@/components/admin/security/AuthPaneSkeleton";
import { AuthStatsGrid } from "@/components/admin/security/AuthStatsGrid";
import { AuthFiltersCard } from "@/components/admin/security/AuthFiltersCard";
import { ActivityTimelineCard } from "@/components/admin/security/ActivityTimelineCard";
import { AuditFiltersCard } from "@/components/admin/security/AuditFiltersCard";
import { AuditTrailErrorCard } from "@/components/admin/security/AuditTrailErrorCard";
import { AuditTrailTable } from "@/components/admin/security/AuditTrailTable";

/** R127-L5 (B15-1): the security page's two panes — the existing auth
 *  timeline and the new audit-trail tab. Settings.tsx's real-tab
 *  semantics (R124-I5 A6 F10): tablist/tab/aria-selected + labelled
 *  panels. */
const SECURITY_TABS = [
  { id: "auth", label: "نشاط المصادقة", icon: Activity },
  { id: "audit", label: "إجراءات المسؤولين", icon: ScrollText },
] as const;

type SecurityTabId = (typeof SECURITY_TABS)[number]["id"];

export function AdminSecurityDashboard() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("admins");
  const headers = useAdminHeaders();
  const [filters, setFilters] = useState({
    action: "all",
    success: "all",
  });

  // R127-L5: the active pane — "auth" is the default so the page's
  // existing surface (and its tests) keep their first-load contract.
  const [activeTab, setActiveTab] = useState<SecurityTabId>("auth");

  // ── Audit-tab state (B15-1) ─────────────────────────────────────────
  // Local filter draft: the action text rides the orders.tsx 300 ms
  // debounce (one request per typing pause, not per keystroke); the
  // actor/date fields fire onChange on complete values only.
  const [auditFilters, setAuditFilters] = useState({
    action: "",
    actor: "",
    startDate: "",
    endDate: "",
  });
  const [debouncedAuditAction, setDebouncedAuditAction] = useState("");
  const [auditPage, setAuditPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAuditAction(auditFilters.action), 300);
    return () => clearTimeout(t);
  }, [auditFilters.action]);

  // Any filter flip restarts the pager at page 1.
  const setAuditFilter = (patch: Partial<typeof auditFilters>) => {
    setAuditFilters((prev) => ({ ...prev, ...patch }));
    setAuditPage(1);
  };

  const auditActorId = (() => {
    const n = Number.parseInt(auditFilters.actor, 10);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  })();

  // 94-C2 (A2 P3-18): stats are UNFILTERED — one key, one mount fetch;
  // manual refresh refetches it.
  const statsQuery = useGetAdminAuthStatsSummary({
    query: { enabled: !!adminToken && canView },
    request: { headers },
  });

  // R125-I5 (A3-5) preserved structurally: the filters sit in the
  // queryKey ("all" params are omitted from the URL exactly like the
  // old URLSearchParams builder), so each flip is a fresh query and the
  // in-flight predecessor can never render — the RQ signal threads the
  // abort through customFetch's AbortSignal.any merge.
  const activitiesQuery = useListAdminAuthActivity(
    {
      action: filters.action !== "all" ? filters.action : undefined,
      success: filters.success !== "all" ? (filters.success as "true" | "false") : undefined,
    },
    {
      query: {
        enabled: !!adminToken && canView,
        // R125-I5 parity: while a flipped filter's window is in flight,
        // the PREVIOUS rows keep rendering (the old code simply never
        // touched `activities` until the new response landed) — no
        // skeleton flash, no false "لا توجد أنشطة" between filters.
        placeholderData: keepPreviousData,
      },
      request: { headers },
    },
  );

  // R127-L5 (B15-1): the audit-trail query — the generated hook over
  // the frozen ?page=&limit= contract. Enabled only when the tab is
  // active (the auth pane's first-load contract is untouched); the
  // filters + page sit in the queryKey (R125-I5 last-request-wins), and
  // keepPreviousData keeps the loaded page standing through filter
  // flips instead of flashing a false empty.
  const auditQuery = useListAdminAuditLogs(
    {
      action: debouncedAuditAction.trim() !== "" ? debouncedAuditAction.trim() : undefined,
      actor: auditActorId,
      startDate: auditFilters.startDate !== "" ? auditFilters.startDate : undefined,
      endDate: auditFilters.endDate !== "" ? auditFilters.endDate : undefined,
      page: auditPage,
      limit: AUDIT_PAGE_SIZE,
    },
    {
      query: {
        enabled: !!adminToken && canView && activeTab === "audit",
        placeholderData: keepPreviousData,
      },
      request: { headers },
    },
  );

  const stats = statsQuery.data ?? null;
  // 94-C2 (A2 P2-14): a mid-session 401 is the global handler's business
  // (toast + redirect already fired inside customFetch) — don't render a
  // local error card on top.
  const statsError =
    statsQuery.isError && !isSessionExpiredError(statsQuery.error)
      ? getErrorMessage(statsQuery.error)
      : null;

  const activities = activitiesQuery.data?.activities ?? [];
  const activitiesError =
    activitiesQuery.isError && !isSessionExpiredError(activitiesQuery.error)
      ? getErrorMessage(activitiesQuery.error)
      : null;
  // The first-load gate (R125-I5 A3-4): the page-shaped skeleton stands
  // until the FIRST window settles — pending with no data. Later filter
  // flips ride the placeholder above and keep the loaded page.
  const loading = activitiesQuery.isPending && !activitiesQuery.data;

  // ── Audit-tab derived state (R127-L5) ────────────────────────────────
  const auditLogs = auditQuery.data?.logs ?? [];
  const auditTotal = auditQuery.data?.total ?? 0;
  const auditHasMore = auditQuery.data?.hasMore ?? false;
  const auditError =
    auditQuery.isError && !isSessionExpiredError(auditQuery.error)
      ? getErrorMessage(auditQuery.error)
      : null;
  // The same first-load gate as the auth pane: the pane skeleton stands
  // until the FIRST page settles (placeholderData covers later flips).
  const auditLoading = auditQuery.isPending && !auditQuery.data;

  // 94-C2 (A2 P3-18): the header renders on FIRST load too — the old
  // bare «جارٍ التحميل…» hid the entire page; the layout refresh button
  // refetches both queries.
  const refreshAll = () => {
    void statsQuery.refetch();
    void activitiesQuery.refetch();
    if (activeTab === "audit") void auditQuery.refetch();
  };

  const exportToCSV = () => {
    // R120-B4 (A5-F14): Arabic headers — the users CSV already ships
    // Arabic and the UTF-8 BOM is emitted below, so Excel renders these
    // correctly. The action VALUE also localizes through actionLabel
    // (the same map the timeline + filter use — A2 P3-18), so the file
    // matches what the operator sees on screen.
    // R128 (B3-F2): both export arms ride the SHARED csvCell
    // (lib/csv.ts) — RFC-4180 quoting PLUS the formula-injection guard
    // (a leading =/+/-/@/tab/CR gets the OWASP apostrophe prefix).
    // This tab's cells embed admin-controlled usernames and
    // telegram-webhook metadata; the auth arm embeds user-controlled
    // identifiers (phones legitimately start with +) — the exact
    // incident-responder exfil chain B3 red-teamed. The previous local
    // escape guarded quotes only.

    if (activeTab === "audit") {
      // R127-L5: the audit tab exports the LOADED page (the count line
      // above the table already discloses «عرض N من إجمالاً M»).
      const auditHeaders = [
        "المعرّف",
        "المسؤول",
        "نوع الفاعل",
        "الإجراء",
        "نوع الهدف",
        "المعرّف الهدف",
        "IP",
        "بيانات إضافية",
        "الوقت",
      ];
      const auditRows = auditLogs.map((l) => [
        l.id,
        l.actorUsername ?? (l.actorId !== null ? `#${l.actorId}` : ""),
        AUDIT_ACTOR_TYPE_LABELS[l.actorType] ?? l.actorType,
        auditActionLabel(l.action),
        l.targetType ?? "",
        l.targetId ?? "",
        l.ip ?? "",
        l.metadata ?? "",
        l.createdAt,
      ]);
      const csvContent =
        "\uFEFF" + [auditHeaders, ...auditRows].map((row) => row.map(csvCell).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `admin-audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }

    const headers = [
      "المعرّف",
      "معرّف المستخدم",
      "هوية الدخول",
      "الإجراء",
      "النجاح",
      "مزود الدخول",
      "سبب الفشل",
      "عنوان IP",
      "التاريخ",
    ];
    const rows = activities.map((a) => [
      a.id,
      a.userId,
      a.identifier,
      actionLabel(a.action),
      a.success,
      a.provider || "",
      a.failureReason || "",
      a.ipAddress || "",
      a.createdAt,
    ]);

    const csvContent =
      "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `auth-activity-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // 94-C2 (A2 P3-18): the loading state renders INSIDE the admin shell
  // (the previous bare centered div appeared before the layout — a
  // flash of structure-less text on every visit).
  // (refreshAll above replaced the old fetchStats/fetchActivities pair.)

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="admins" />;
  }

  return (
    <AdminLayout onRefresh={refreshAll}>
      <div className="space-y-6">
        {/* R125-I5 (A3-4): the header renders on FIRST load too — the
            old bare «جارٍ التحميل…» used to hide the entire page
            (header + CSV affordance included), the last list surface
            with no layout preservation. The CSV button stays disabled
            until the window is loaded (it exports what's rendered).
            R127-L5: the button is tab-aware — it exports the ACTIVE
            pane's loaded rows, and each arm's title discloses its
            window. */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-xl font-bold">لوحة أمان المصادقة</h1>
          </div>
          <Button
            onClick={exportToCSV}
            variant="outline"
            size="sm"
            disabled={activeTab === "auth" ? loading : auditLoading}
            /* R125-I5 (A3-5): the export discloses its window up front —
                it exports the LOADED rows (the same ≤100-event window
                the timeline shows under the current filters), not a
                complete history. */
            title={
              activeTab === "audit"
                ? "تصدير الإجراءات المطابقة للفلاتر الحالية — الصفحة المحمّلة فقط"
                : "تصدير الأحداث المطابقة للفلاتر الحالية ضمن النافذة المعروضة — أحدث 100 حدث كحد أقصى"
            }
          >
            <Download className="w-4 h-4 ml-2" />
            تصدير CSV
          </Button>
        </div>

        {/* R127-L5 (B15-1): the tab bar — settings.tsx's real-tab
            semantics (R124-I5 A6 F10): tablist + tab + aria-selected,
            each pane below carries role="tabpanel" +
            aria-labelledby. */}
        <div
          role="tablist"
          aria-label="أقسام الأمان"
          className="flex flex-wrap gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1 w-fit"
        >
          {SECURITY_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`security-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
                activeTab === tab.id
                  ? "bg-card shadow-sm text-foreground font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "audit" ? (
          <div role="tabpanel" aria-labelledby="security-tab-audit" className="space-y-6">
            {/* ── Audit filters (B15-1: action / actor / date range) ── */}
            <AuditFiltersCard auditFilters={auditFilters} onFilterChange={setAuditFilter} />

            {/* ── Audit trail table ───────────────────────────────── */}
            <div className="bg-card border border-border/55 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-lg font-bold">سجل إجراءات المسؤولين</h2>
                {/* Honest count (the users/topups idiom): the loaded
                    page vs the server's total under the current
                    filters. */}
                {auditLogs.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    عرض {formatCount(auditLogs.length, AUDIT_COUNT_FORMS)} من إجمالاً{" "}
                    {formatCount(auditTotal, AUDIT_COUNT_FORMS)}
                  </span>
                )}
              </div>

              {auditLoading ? (
                /* R136 (UX-1): SkeletonText — the first-load pane
                   skeleton. Same DOM as the hand-rolled R125-I5 block
                   (ONE announcing wrapper + 6 plain rows, role=status +
                   sr-only preserved; the wrapper's aria-busy rides off —
                   the region's content already says «جارٍ التحميل…», the
                   pair TableSkeleton carries). The page-shaped
                   first-load tree below keeps its own wrapper and stays
                   hand-rolled: its children would nest live regions
                   inside it (double announce + getByRole("status")
                   breakage). */
                <SkeletonText
                  count={6}
                  wrapperClassName="space-y-3"
                  className="h-14 rounded-lg"
                  lastShorter={false}
                />
              ) : auditError ? (
                /* 94-C2 (A2 P2-1) idiom: a failed load is an error card
                   with retry — NOT a false «لا توجد إجراءات» empty. */
                <AuditTrailErrorCard
                  auditError={auditError}
                  onRetry={() => void auditQuery.refetch()}
                />
              ) : auditLogs.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title="لا توجد إجراءات مسجّلة"
                  description="تظهر الإجراءات هنا كلما نفّذ المسؤولون عمليات مؤثرة (اعتماد الأرصدة، الاسترداد، تعديل المستخدمين وغيرها)"
                />
              ) : (
                <AuditTrailTable
                  auditLogs={auditLogs}
                  auditPage={auditPage}
                  setAuditPage={setAuditPage}
                  auditHasMore={auditHasMore}
                  isFetching={auditQuery.isFetching}
                />
              )}
            </div>
          </div>
        ) : loading ? (
          // R125-I5 (A3-4): page-shaped skeleton (the alerts.tsx card
          // recipe) — stats grid + filter bar + timeline rows keep
          // their shape while the first load is in flight. Carries the
          // A6-B8 role="status" + sr-only label pair.
          <AuthPaneSkeleton />
        ) : (
          <>
            {/* Stats Cards */}
            {/* 94-C2 (A2 P2-1): a failed stats load surfaces an error card
            with retry instead of the cards silently disappearing. */}
            {statsError && (
              <div
                role="alert"
                className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
              >
                <WifiOff className="w-4 h-4 shrink-0" />
                <span className="min-w-0">{statsError}</span>
                <button
                  type="button"
                  onClick={() => void statsQuery.refetch()}
                  className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
            {stats && <AuthStatsGrid stats={stats} />}

            {/* Filters */}
            <AuthFiltersCard filters={filters} onFiltersChange={setFilters} />

            {/* Activity Timeline */}
            <ActivityTimelineCard
              activities={activities}
              activitiesError={activitiesError}
              onRetry={() => void activitiesQuery.refetch()}
            />
          </>
        )}
      </div>
    </AdminLayout>
  );
}

export default AdminSecurityDashboard;

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
