import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
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
import {
  Activity,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  ScrollText,
  Shield,
  WifiOff,
  XCircle,
} from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  unlink_provider: "فصل مزود",
};

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

/**
 * R127-L5 (B15-1): the audit-trail tab's Arabic action map — the
 * actionLabel idiom applied to the `<resource>.<verb>` audit action
 * strings (the writer inventory across admin/topups, users, orders,
 * coupons, products, pricing, flash-sales, tickets, risk, admins,
 * alerts, whatsapp, settings + the B11-F1 telegram webhook rows).
 * Unknown actions fall back to the raw stable string (honest, and a
 * new writer can't break the tab).
 */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "topup.approve": "اعتماد شحن رصيد",
  "topup.reject": "رفض شحن رصيد",
  "user.update": "تحديث مستخدم",
  "order.credentials_view": "عرض بيانات طلب",
  "order.bulk_refund": "استرداد جماعي للطلبات",
  "order.bulk_status_update": "تحديث حالة الطلبات جماعياً",
  "referral.credit": "قيد نقاط إحالة",
  "coupon.create": "إنشاء كوبون",
  "coupon.update": "تحديث كوبون",
  "coupon.archive": "أرشفة كوبون",
  "product.create": "إنشاء منتج",
  "product.update": "تحديث منتج",
  "product.archive": "أرشفة منتج",
  "product.inventory.set-count": "تعيين مخزون منتج",
  "product.inventory.upload": "رفع مخزون منتج",
  "product.variant.create": "إنشاء خيار منتج",
  "product.variant.update": "تحديث خيار منتج",
  "product.variant.delete": "حذف خيار منتج",
  "pricing.config.update": "تحديث إعدادات التسعير",
  "pricing.recompute": "إعادة احتساب الأسعار",
  "flash_sale.create": "إنشاء عرض فلاش",
  "flash_sale.update": "تحديث عرض فلاش",
  "flash_sale.deactivate": "إيقاف عرض فلاش",
  "ticket.reply": "رد على تذكرة",
  "ticket.status_update": "تحديث حالة تذكرة",
  "risk.label": "وسم حدث مخاطر",
  "risk.rule_update": "تحديث قاعدة مخاطر",
  "risk.config_update": "تحديث إعدادات المخاطر",
  "risk.synth": "إنشاء حدث مخاطر تجريبي",
  "risk.soft_block_applied": "حظر مؤقت لمستخدم",
  "risk.hard_block_applied": "حظر دائم لمستخدم",
  "admin.created": "إنشاء مسؤول",
  "admin.updated": "تحديث مسؤول",
  "admin.disabled": "تعطيل مسؤول",
  "admin.enabled": "تفعيل مسؤول",
  "admin.logout": "تسجيل خروج مسؤول",
  "admin.password_changed": "تغيير كلمة مرور المسؤول",
  "admin.totp_enabled": "تفعيل المصادقة الثنائية",
  "admin.totp_disabled": "تعطيل المصادقة الثنائية",
  "alert.test_dispatch": "إرسال تنبيه تجريبي",
  "whatsapp.session_create": "إنشاء جلسة واتساب",
  "whatsapp.session_start": "تشغيل جلسة واتساب",
  "whatsapp.session_pair_code": "ربط جلسة واتساب",
  "whatsapp.session_delete": "حذف جلسة واتساب",
  "settings.auth_provider.update": "تحديث مزود مصادقة",
};

const auditActionLabel = (a: string) => AUDIT_ACTION_LABELS[a] ?? a;

const AUDIT_ACTOR_TYPE_LABELS: Record<string, string> = {
  admin: "مسؤول",
  user: "مستخدم",
  system: "النظام",
};

/** R125-I5 (A3-5): the backend hard-caps auth-activity at .limit(100)
 *  (admin/security.ts) with no page param and no total — the window the
 *  UI receives is always "the newest 100 at most". Surfaced honestly
 *  instead of presenting a truncated audit log as complete. */
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

/** R127-L5: the audit tab's page size — matches the endpoint's default
 * (backend clamps to [1, 200]; the UI pins it so the «عرض N من إجمالاً
 * M» counter and the pager stay in lockstep). */
const AUDIT_PAGE_SIZE = 50;

/** Arabic plural forms for the audit-trail counter (formatCount). */
const AUDIT_COUNT_FORMS = {
  zero: "إجراءات",
  one: "إجراء",
  two: "إجراءان",
  few: "إجراءات",
  many: "إجراءًا",
  other: "إجراء",
};

/** R127-L5 (B15-1): the security page's two panes — the existing auth
 *  timeline and the new audit-trail tab. Settings.tsx's real-tab
 *  semantics (R124-I5 A6 F10): tablist/tab/aria-selected + labelled
 *  panels. */
const SECURITY_TABS = [
  { id: "auth", label: "نشاط المصادقة", icon: Activity },
  { id: "audit", label: "إجراءات المسؤولين", icon: ScrollText },
] as const;

type SecurityTabId = (typeof SECURITY_TABS)[number]["id"];

/** B11-F1 rows identify the actor in metadata (actorId is null for the
 * telegram webhook path) — a compact `key=value` join of the parsed
 * payload, LTR + truncated, so the tab names WHO without dumping the
 * raw JSON blob. */
function auditMetadataLine(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    return entries.length > 0 ? entries.slice(0, 6).join(" · ") : null;
  } catch {
    return null;
  }
}

export function AdminSecurityDashboard() {
  const { adminToken } = useAuth();
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
        enabled: !!adminToken && activeTab === "audit",
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
            <div className="bg-card border border-border/55 rounded-xl p-4 flex gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label htmlFor="audit-action-filter" className="text-sm font-semibold">
                  الإجراء:
                </label>
                <input
                  id="audit-action-filter"
                  type="text"
                  value={auditFilters.action}
                  onChange={(e) => setAuditFilter({ action: e.target.value })}
                  placeholder="topup.approve"
                  dir="ltr"
                  className="px-3 py-1.5 border rounded text-sm w-48"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="audit-actor-filter" className="text-sm font-semibold">
                  معرّف المسؤول:
                </label>
                <input
                  id="audit-actor-filter"
                  type="number"
                  min={1}
                  value={auditFilters.actor}
                  onChange={(e) => setAuditFilter({ actor: e.target.value })}
                  placeholder="مثال: 1"
                  dir="ltr"
                  className="px-3 py-1.5 border rounded text-sm w-28"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="audit-start-date" className="text-sm font-semibold">
                  من تاريخ:
                </label>
                <input
                  id="audit-start-date"
                  type="date"
                  value={auditFilters.startDate}
                  onChange={(e) => setAuditFilter({ startDate: e.target.value })}
                  className="px-3 py-1.5 border rounded text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="audit-end-date" className="text-sm font-semibold">
                  إلى تاريخ:
                </label>
                <input
                  id="audit-end-date"
                  type="date"
                  value={auditFilters.endDate}
                  onChange={(e) => setAuditFilter({ endDate: e.target.value })}
                  className="px-3 py-1.5 border rounded text-sm"
                />
              </div>
            </div>

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
                // First-load pane skeleton (A6-B8 role=status + the
                // page-shaped shimmer idiom).
                <div className="space-y-3" role="status" aria-busy="true">
                  <span className="sr-only">جارٍ التحميل…</span>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-lg skeleton-shimmer" />
                  ))}
                </div>
              ) : auditError ? (
                /* 94-C2 (A2 P2-1) idiom: a failed load is an error card
                   with retry — NOT a false «لا توجد إجراءات» empty. */
                <div className="text-center py-10 text-muted-foreground">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
                    <WifiOff className="w-7 h-7 text-status-error/70" />
                  </div>
                  <p className="font-bold text-base mb-1.5 text-foreground/80">
                    تعذّر تحميل سجل الإجراءات
                  </p>
                  <p className="text-sm mb-5 max-w-xs mx-auto leading-relaxed">{auditError}</p>
                  <Button
                    onClick={() => void auditQuery.refetch()}
                    className="gap-2 font-bold"
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    إعادة المحاولة
                  </Button>
                </div>
              ) : auditLogs.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title="لا توجد إجراءات مسجّلة"
                  description="تظهر الإجراءات هنا كلما نفّذ المسؤولون عمليات مؤثرة (اعتماد الأرصدة، الاسترداد، تعديل المستخدمين وغيرها)"
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-right text-xs text-muted-foreground border-b border-border/55">
                          <th scope="col" className="py-2 px-3 font-semibold">
                            المسؤول
                          </th>
                          <th scope="col" className="py-2 px-3 font-semibold">
                            الإجراء
                          </th>
                          <th scope="col" className="py-2 px-3 font-semibold">
                            الهدف
                          </th>
                          <th scope="col" className="py-2 px-3 font-semibold">
                            IP
                          </th>
                          <th scope="col" className="py-2 px-3 font-semibold">
                            الوقت
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="border-b border-border/30 align-top">
                            <td className="py-2.5 px-3">
                              {/* R128 (B3-F4): the @username attribution is
                                  admin/webhook-controlled text that
                                  rendered with inherited RTL direction —
                                  a username carrying RLO/LRO bidi
                                  controls visually reorders WHO approved
                                  WHAT in the accountability artifact this
                                  tab exists for. dir="ltr" implies
                                  unicode-bidi: isolate (mirrors the
                                  metadata/action/target/ip cells around
                                  it); applied to the username branch only
                                  — the fallback branches render local
                                  Arabic labels. truncate + the metadata
                                  line's max-w keep a long username from
                                  blowing the column. */}
                              <div
                                dir={log.actorUsername ? "ltr" : undefined}
                                className="font-semibold max-w-[240px] truncate"
                              >
                                {log.actorUsername
                                  ? `@${log.actorUsername}`
                                  : log.actorId !== null
                                    ? `${AUDIT_ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType} #${log.actorId}`
                                    : (AUDIT_ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType)}
                              </div>
                              {/* B11-F1 attribution: the metadata line
                                  names the telegram actor / source the
                                  actorId column can't. */}
                              {auditMetadataLine(log.metadata) && (
                                <div
                                  dir="ltr"
                                  className="text-3xs text-muted-foreground mt-0.5 max-w-[240px] truncate"
                                >
                                  {auditMetadataLine(log.metadata)}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-semibold">
                              {auditActionLabel(log.action)}
                              <div dir="ltr" className="text-3xs text-muted-foreground mt-0.5">
                                {log.action}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-muted-foreground" dir="ltr">
                              {log.targetType
                                ? `${log.targetType}${log.targetId !== null ? ` #${log.targetId}` : ""}`
                                : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-muted-foreground" dir="ltr">
                              {log.ip ?? "—"}
                            </td>
                            <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                              {formatDate(log.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Finite pager over the frozen page/limit contract
                      (hasMore is the server's honest flag). */}
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xs text-muted-foreground">الصفحة {auditPage}</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={auditPage <= 1 || auditQuery.isFetching}
                        onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        السابقة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!auditHasMore || auditQuery.isFetching}
                        onClick={() => setAuditPage((p) => p + 1)}
                      >
                        التالية
                        <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : loading ? (
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
