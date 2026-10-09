import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled bare "لا توجد أنشطة" empty
// state adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { useAuth } from "@/lib/auth";
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
import { useGetAdminAuthStatsSummary, useListAdminAuthActivity } from "@workspace/api-client-react";
import { Activity, CheckCircle, Download, RefreshCw, Shield, WifiOff, XCircle } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { AdminLayout } from "./layout";
import { formatCount, formatDate } from "@/lib/utils";

// R126-L8b: customFetch rejects 401s with its ApiError — type-only from
// the package, so the quiet-catch duck-types the `status` field (the
// App.tsx isRetryableQueryError idiom).
function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

/** 94-C2 (A2 P3-18): the timeline used to render the raw backend
 *  `action` enum in English ("login") while the filter select next to
 *  it showed the same value in Arabic — one shared map keeps the two
 *  in lockstep. */
const ACTION_LABELS: Record<string, string> = {
  login: "تسجيل دخول",
  register: "تسجيل",
  logout: "تسجيل خروج",
  change_password: "تغيير كلمة المرور",
  unlink_provider: "فصل مزوّد",
};

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

/** R125-I5 (A3-5): the backend hard-caps auth-activity at .limit(100)
 * (admin/security.ts) with no page param and no total — the window the
 * UI receives is always "the newest 100 at most". Surfaced honestly
 * instead of presenting a truncated audit log as complete. */
const ACTIVITY_WINDOW_CAP = 100;

/** Arabic plural forms for the timeline counter (formatCount, A2 P3-4). */
const ACTIVITY_COUNT_FORMS = {
  zero: "أحداث",
  one: "حدث",
  two: "حدثان",
  few: "أحداث",
  many: "حدثاً",
  other: "حدث",
};

export function AdminSecurityDashboard() {
  const { adminToken } = useAuth();
  const headers = useAdminHeaders();
  const [filters, setFilters] = useState({
    action: "all",
    success: "all",
  });

  // 94-C2 (A2 P3-18): stats are UNFILTERED — one key, one mount fetch;
  // manual refresh refetches it.
  const statsQuery = useGetAdminAuthStatsSummary({
    query: { enabled: !!adminToken },
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
        enabled: !!adminToken,
        // R125-I5 parity: while a flipped filter's window is in flight,
        // the PREVIOUS rows keep rendering (the old code simply never
        // touched `activities` until the new response landed) — no
        // skeleton flash, no false "لا توجد أنشطة" between filters.
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

  // 94-C2 (A2 P3-18): the header renders on FIRST load too — the old
  // bare «جارٍ التحميل…» hid the entire page; the layout refresh button
  // refetches both queries.
  const refreshAll = () => {
    void statsQuery.refetch();
    void activitiesQuery.refetch();
  };

  const exportToCSV = () => {
    // R120-B4 (A5-F14): Arabic headers — the users CSV already ships
    // Arabic and the UTF-8 BOM is emitted below, so Excel renders these
    // correctly. The action VALUE also localizes through actionLabel
    // (the same map the timeline + filter use — A2 P3-18), so the file
    // matches what the operator sees on screen.
    const headers = [
      "المعرّف",
      "معرّف المستخدم",
      "هوية الدخول",
      "الإجراء",
      "النجاح",
      "مزوّد الدخول",
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

    const escapeCsvField = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

    const csvContent =
      "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\n");
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

  return (
    <AdminLayout onRefresh={refreshAll}>
      <div className="space-y-6">
        {/* R125-I5 (A3-4): the header renders on FIRST load too — the
            old bare «جارٍ التحميل…» used to hide the entire page
            (header + CSV affordance included), the last list surface
            with no layout preservation. The CSV button stays disabled
            until the window is loaded (it exports what's rendered). */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">لوحة أمان المصادقة</h1>
          </div>
          <Button
            onClick={exportToCSV}
            variant="outline"
            size="sm"
            disabled={loading}
            /* R125-I5 (A3-5): the export discloses its window up front —
                it exports the LOADED rows (the same ≤100-event window
                the timeline shows under the current filters), not a
                complete history. */
            title="تصدير الأحداث المطابقة للفلاتر الحالية ضمن النافذة المعروضة — أحدث 100 حدث كحد أقصى"
          >
            <Download className="w-4 h-4 ml-2" />
            تصدير CSV
          </Button>
        </div>

        {loading ? (
          // R125-I5 (A3-4): page-shaped skeleton (the alerts.tsx card
          // recipe) — stats grid + filter bar + timeline rows keep
          // their shape while the first load is in flight. Carries the
          // A6-B8 role="status" + sr-only label pair.
          <div className="space-y-6" role="status" aria-busy="true">
            <span className="sr-only">جارٍ التحميل…</span>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[76px] rounded-xl skeleton-shimmer border border-border/55"
                />
              ))}
            </div>
            <div className="h-[76px] rounded-xl skeleton-shimmer border border-border/55" />
            <div className="bg-card border border-border/55 rounded-xl p-4 space-y-3">
              <div className="h-5 w-24 skeleton-shimmer rounded" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[76px] rounded-lg skeleton-shimmer" />
              ))}
            </div>
          </div>
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
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card border border-border/55 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <Activity className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">إجمالي الأنشطة</p>
                      <p className="text-2xl font-bold">{stats.total}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-card border border-border/55 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-status-success" />
                    <div>
                      <p className="text-sm text-muted-foreground">ناجحة</p>
                      <p className="text-2xl font-bold text-status-success">{stats.success}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-card border border-border/55 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-destructive" />
                    <div>
                      <p className="text-sm text-muted-foreground">فاشلة</p>
                      <p className="text-2xl font-bold text-destructive">{stats.failure}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-card border border-border/55 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">آخر 24 ساعة</p>
                      <p className="text-2xl font-bold">{stats.last24h}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="bg-card border border-border/55 rounded-xl p-4 flex gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label htmlFor="security-f1-11119" className="text-sm font-semibold">
                  الإجراء:
                </label>
                <select
                  id="security-f1-11119"
                  value={filters.action}
                  onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                  className="px-3 py-1.5 border rounded text-sm"
                >
                  <option value="all">الكل</option>
                  <option value="login">تسجيل دخول</option>
                  <option value="register">تسجيل</option>
                  <option value="logout">تسجيل خروج</option>
                  <option value="change_password">تغيير كلمة المرور</option>
                  <option value="unlink_provider">فصل مزود</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="security-f2-9574" className="text-sm font-semibold">
                  الحالة:
                </label>
                <select
                  id="security-f2-9574"
                  value={filters.success}
                  onChange={(e) => setFilters({ ...filters, success: e.target.value })}
                  className="px-3 py-1.5 border rounded text-sm"
                >
                  <option value="all">الكل</option>
                  <option value="true">ناجح</option>
                  <option value="false">فاشل</option>
                </select>
              </div>
            </div>

            {/* Activity Timeline */}
            <div className="bg-card border border-border/55 rounded-xl p-4">
              {/* R125-I5 (A3-5): honest count — the timeline used to render
                whatever arrived under a bare «سجل النشاط» heading, an
                audit log presented as complete. The header now names the
                window («عرض N (الأحدث أولاً)», the users/topups count
                idiom) and, when the backend's 100-row cap is hit,
                discloses that older events exist but are not loaded
                (backend pagination stays as-is — frontend honesty
                only). */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-lg font-bold">سجل النشاط</h2>
                {activities.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span>
                      عرض {formatCount(activities.length, ACTIVITY_COUNT_FORMS)} (الأحدث أولاً)
                    </span>
                    {activities.length >= ACTIVITY_WINDOW_CAP && (
                      <span className="block mt-0.5 text-status-warning">
                        يعرض أحدث {formatCount(ACTIVITY_WINDOW_CAP, ACTIVITY_COUNT_FORMS)} فقط — قد
                        تكون هناك أحداث أقدم
                      </span>
                    )}
                  </div>
                )}
              </div>
              {/* 94-C2 (A2 P2-1): a failed activity load is an error card
              with retry — NOT the "لا توجد أنشطة" false-empty state an
              expired session used to render. */}
              {activitiesError ? (
                <div className="text-center py-10 text-muted-foreground">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
                    <WifiOff className="w-7 h-7 text-status-error/70" />
                  </div>
                  <p className="font-bold text-base mb-1.5 text-foreground/80">
                    تعذّر تحميل سجل النشاط
                  </p>
                  <p className="text-sm mb-5 max-w-xs mx-auto leading-relaxed">{activitiesError}</p>
                  <Button
                    onClick={() => void activitiesQuery.refetch()}
                    className="gap-2 font-bold"
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    إعادة المحاولة
                  </Button>
                </div>
              ) : activities.length === 0 ? (
                <EmptyState icon={Activity} title="لا توجد أنشطة" />
              ) : (
                <div className="space-y-3">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-4 p-4 border border-border/40 rounded-lg bg-muted/20"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                        {activity.success ? (
                          <CheckCircle className="w-4 h-4 text-status-success" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{actionLabel(activity.action)}</span>
                          <span className="text-xs text-muted-foreground">
                            {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits —
                            engines without ar-LY data fall back to the
                            "ar" root and emit Arabic-Indic numerals. */}
                            {formatDate(activity.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{activity.identifier}</p>
                        {activity.failureReason && (
                          <p className="text-xs text-destructive mt-1">{activity.failureReason}</p>
                        )}
                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                          {activity.provider && <span>المزود: {activity.provider}</span>}
                          {activity.ipAddress && <span>IP: {activity.ipAddress}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

export default AdminSecurityDashboard;

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
