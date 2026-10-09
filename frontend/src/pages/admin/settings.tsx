import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
// R123 (E3 item 1): the seven raw fetches ride the session-aware
// wrappers — a settings cookie expiring mid-work now gets the global
// «انتهت الجلسة» toast + redirect instead of a per-form error line,
// and adminFetchJson owns the ok-guard + safe error-body parse (the
// 2FA paths previously did an unguarded r.json() BEFORE the !res.ok
// check — a non-JSON 502 threw an English SyntaxError into the Arabic
// error line). /api/admin/session below stays response-exempt by
// design (App.tsx owns its 401) — adminFetch passes it through
// untouched, so the .then chain's reject-on-!ok semantics are
// preserved. fetchJsonOrNull keeps its R120-B4 isAdminUnauthorized
// guard (already 401-aware).
import { AdminSessionExpiredError, adminFetchJson, isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
// B14-5 (R127-L11): the auth-summary banner joins the repo's formatCount
// plural-router idiom (wallet.tsx / topups.tsx TOPUP_COUNT_FORMS).
import { formatCount } from "@/lib/utils";
// 93-C7 / C-UX2 (A12 B17): configured/secret/telegram pills migrate
// from raw emerald/yellow hues (+ a square `rounded` on the secret
// chip) to the canonical StatusBadge on the --status-* tokens.
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Bell,
  Bot,
  CheckCircle,
  Hash,
  Info,
  Key,
  KeyRound,
  Loader2,
  Shield,
  UserCog,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";
// R126-L9 (A3 split plan D): the three tab surfaces moved to
// ./settings/* modules (byte-move, zero behavior change) — this file
// stays the route entry (App.tsx lazy-imports it) and owns the tab
// shell, the ?tab= URL contract, and the scope gate.
import { AccountTab } from "./settings/account-tab";
import { ProviderCard, type AuthProvider } from "./settings/provider-card";
import { TwoFactorSetup } from "./settings/two-factor-setup";

interface TelegramSettings {
  telegram_chat_set: boolean;
  /** Present when API exposes aggregate Telegram readiness */
  telegram_configured?: boolean;
  telegram_bot_set?: boolean;
}

const TABS = [
  { id: "account", label: "حسابي", icon: UserCog },
  { id: "auth", label: "المصادقة", icon: KeyRound },
  { id: "integrations", label: "التكاملات", icon: Bot },
  { id: "notifications", label: "الإشعارات", icon: Bell },
  { id: "security", label: "الأمان", icon: Shield },
];

/** R123 (E3 P3f): المصادقة + التكاملات manage settings-scoped backend
 *  surfaces — this pure module-level gate (the tab bar filter, the ?tab=
 *  sync and the deep-link initializer all share it) keeps its only
 *  per-session input a parameter, so the URL→tab effect below can list
 *  that input in its deps instead of a per-render closure. */
function tabAllowed(id: string, canManageSettings: boolean): boolean {
  return id === "auth" || id === "integrations" ? canManageSettings : true;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  const adminHeaders = useAdminHeaders();
  const [, navigate] = useLocation();
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [loading, setLoading] = useState(true);
  // R120-B4 (A2-F10): the settings/providers fetches used to swallow
  // failures with `.catch(() => null)` — an outage or expired session
  // rendered empty rows («غير موجود» per key) instead of an error
  // surface. The failure is now first-class: the card below carries the
  // Arabic reason + retry.
  const [loadError, setLoadError] = useState<string | null>(null);
  // R123 (E3 P3f): المصادقة + التكاملات manage settings-scoped backend
  // surfaces (PUT /api/admin/settings*, PATCH /api/admin/settings/auth/*)
  // — every admin could see the tabs and 403 on first save. The
  // canEditMoney idiom (users.tsx A2-F4): scope-honest UI up front —
  // the two tabs hide for scope-less admins (account/notifications/
  // security are self-service and stay for everyone), the URL ?tab=
  // sync respects the scope, and a scope-less ?tab=auth deep link lands
  // on the honest reason instead of a 403 wall.
  const canManageSettings = hasAdminPermission("settings");
  // R120-B4 (A2-F20): activeTab is URL-addressable (?tab=) — deep
  // links survive refresh/share, and tab clicks update the address
  // (two-way sync, the orders ?search= idiom).
  const searchParam = useSearch();
  const [activeTab, setActiveTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t && TABS.some((x) => x.id === t) && tabAllowed(t, canManageSettings) ? t : "account";
  });

  // Telegram diagnostic-ping state. Operator hits the "اختبار" button →
  // we POST /api/admin/diagnostics/telegram-test and render the
  // structured result inline so the operator sees end-to-end whether
  // the bot is actually reachable from this server.
  const [tgTesting, setTgTesting] = useState(false);
  const [tgTestResult, setTgTestResult] = useState<{
    configured: boolean;
    delivered: boolean;
    attempts: number;
    errorMessage: string | null;
    hint: string | null;
  } | null>(null);

  async function runTelegramTest(): Promise<void> {
    if (!adminToken) return;
    setTgTesting(true);
    try {
      // R123 (E3 item 1): adminFetchJson owns the ok-guard + safe parse
      // — a non-JSON 502 no longer fabricates a structured result.
      const body = await adminFetchJson<{
        configured: boolean;
        delivered: boolean;
        attempts: number;
        errorMessage: string | null;
        hint: string | null;
      }>("/api/admin/diagnostics/telegram-test", {
        method: "POST",
        headers: adminHeaders,
      });
      setTgTestResult(body);
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      setTgTestResult({
        configured: false,
        delivered: false,
        attempts: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
        hint: "تعذّر الوصول إلى نقطة الاختبار — تحقّق من الشبكة وجلسة الإدارة.",
      });
    } finally {
      setTgTesting(false);
    }
  }

  // R120-B4 (A2-F10): r.ok + isAdminUnauthorized FIRST (the orders
  // error-card idiom) — the bodies are parsed only on OK, and a 401
  // mid-session defers to the global handler instead of a local error
  // card on top.
  const fetchJsonOrNull = async (url: string): Promise<Record<string, unknown> | null> => {
    const res = await fetch(url, { headers: adminHeaders });
    if (isAdminUnauthorized(res, url)) throw new Error("__unauthorized__");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new Error(getErrorMessage(body) || `فشل التحميل (HTTP ${res.status})`);
    }
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  };

  const loadSettingsAndProviders = async (): Promise<void> => {
    setLoadError(null);
    try {
      const [sysSettings, authData] = await Promise.all([
        fetchJsonOrNull("/api/admin/settings"),
        fetchJsonOrNull("/api/admin/settings/auth"),
      ]);
      if (sysSettings) setSettings(sysSettings as unknown as TelegramSettings);
      if (authData && Array.isArray(authData.providers))
        setProviders(authData.providers as AuthProvider[]);
    } catch (err) {
      if (err instanceof Error && err.message === "__unauthorized__") {
        // The global 401 handler toasted + redirected — nothing local.
        setLoading(false);
        return;
      }
      setLoadError(err instanceof Error && err.message ? err.message : "تعذّر تحميل الإعدادات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken) void loadSettingsAndProviders();
    // Mount-only by design (mirrors the original effect): adminHeaders
    // is referentially stable per session (useAdminHeaders rides a
    // useMemo), so depending on the per-render closure would refetch
    // for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  // R120-B4 (A2-F20): URL → tab (a ?tab= change lands without
  // clobbering a tab the operator already picked locally).
  // R123 (E3 P3f): the scope gate rides along — a scope-less deep
  // link to ?tab=auth stays on the honest-reason fallback below.
  useEffect(() => {
    const t = new URLSearchParams(searchParam).get("tab");
    if (t && TABS.some((x) => x.id === t) && tabAllowed(t, canManageSettings)) {
      setActiveTab((prev) => (prev === t ? prev : t));
    }
  }, [searchParam, canManageSettings]);

  // R120-B4 (A2-F20): tab → URL (replaceState — tab flips don't spam
  // the history stack).
  const selectTab = (id: string) => {
    setActiveTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url.toString());
  };

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

  const enabledCount = providers.filter((p) => p.enabled).length;

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold mb-0.5">الإعدادات</h1>
          <p className="text-muted-foreground text-sm">
            إعدادات النظام والتكاملات وإدارة طرق المصادقة
          </p>
        </div>

        {/* Tab bar */}
        {/* R124-I5 (A6 F10): real tab semantics — the five content panes
            made the active tab purely visual for assistive tech. The bar
            is a tablist; each button is a tab with aria-selected; each
            pane below carries role="tabpanel" + aria-labelledby. */}
        <div
          role="tablist"
          aria-label="أقسام الإعدادات"
          className="flex flex-wrap gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1 w-fit"
        >
          {/* R123 (E3 P3f): auth + integrations render only for
              settings-scoped admins (the tabAllowed gate above). */}
          {TABS.filter((tab) => tabAllowed(tab.id, canManageSettings)).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              onClick={() => selectTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${activeTab === tab.id ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* R123 (E3 P3f): the scope-honest fallback (canEditMoney idiom)
            — only reachable via a stale local activeTab, never via the
            tab bar or a deep link (both respect tabAllowed). */}
        {/* R126-L5 (A3-4): the scope-gate banner rides the
            --status-warning ink+tint pair — raw amber-500 on its /10
            tint measured 1.99:1 on the light theme (A6-B4's figure);
            the token measures 6.04:1 on white / 5.09:1 on the /12 tint
            light and ≥9:1 dark (index.css F3-06). */}
        {(activeTab === "auth" || activeTab === "integrations") && !canManageSettings && (
          <p className="text-xs text-status-warning bg-status-warning/10 border border-status-warning/25 rounded-xl px-3 py-2">
            إدارة المصادقة والتكاملات تتطلب صلاحية الإعدادات — تواصل مع مسؤول النظام
          </p>
        )}

        {/* ── Account Tab ─────────────────────────────────────────────── */}
        {activeTab === "account" && adminToken && (
          <div role="tabpanel" aria-labelledby="settings-tab-account">
            <AccountTab adminToken={adminToken} />
          </div>
        )}

        {/* ── Auth Providers Tab ─────────────────────────────────────────── */}
        {activeTab === "auth" && canManageSettings && (
          <div role="tabpanel" aria-labelledby="settings-tab-auth" className="space-y-5">
            {/* Summary banner */}
            <div className="flex items-center gap-3 px-5 py-3.5 bg-card border border-border/60 rounded-2xl float-in">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-sm">طرق تسجيل الدخول</div>
                <div className="text-xs text-muted-foreground">
                  {/* 93-C7 / C-UX5 (A11 top-20 #6): the platform is
                      passwordless for USERS (phone OTP + OAuth) — the old
                      copy promised users a password login that does not
                      exist; the admin's OWN password (AccountTab) is
                      untouched. */}
                  {/* B14-5 (R127-L11): formatCount plural routing — the
                      frozen singular rendered «2 طريقة مفعّلة»/
                      «3 طريقة مفعّلة» for n=2/n=3. */}
                  {enabledCount === 0
                    ? "لا توجد طرق مفعّلة — سيظهر للمستخدمين الدخول برقم الهاتف (رمز تحقق) فقط"
                    : `${formatCount(enabledCount, {
                        one: "طريقة مفعّلة",
                        two: "طريقتان مفعّلتان",
                        few: "طرق مفعّلة",
                        many: "طريقة مفعّلة",
                        other: "طريقة مفعّلة",
                      })} إضافةً إلى الدخول برقم الهاتف (رمز تحقق)`}
                </div>
              </div>
              {/* R126-L5 (A3-4): the auth-summary pill joins the :889
                  role-badge idiom on text-primary-text (raw text-primary
                  on the /10 tint is 3.56:1 dark). */}
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full border ${enabledCount > 0 ? "bg-primary/10 text-primary-text border-primary/20" : "bg-muted text-muted-foreground border-border"}`}
              >
                {enabledCount}/{providers.length}
              </span>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 skeleton-shimmer rounded-2xl" />
                ))}
              </div>
            ) : loadError ? (
              /* R120-B4 (A2-F10): the shared error-card idiom — a failed
                  providers load is NOT an empty provider list. */
              <div
                role="alert"
                className="text-center py-10 text-muted-foreground bg-card border border-status-error/22 rounded-2xl"
              >
                <p className="font-bold text-sm mb-1.5 text-foreground/80">
                  تعذّر تحميل طرق المصادقة
                </p>
                <p className="text-xs mb-5 max-w-xs mx-auto leading-relaxed">{loadError}</p>
                <Button onClick={() => void loadSettingsAndProviders()} size="sm" variant="outline">
                  إعادة المحاولة
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    adminToken={adminToken}
                    onUpdate={(updated) =>
                      setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                    }
                  />
                ))}
              </div>
            )}

            {/* Info box */}
            <div className="flex items-start gap-3 p-4 bg-muted/30 border border-border/50 rounded-2xl">
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
                <p className="font-bold text-foreground/80">كيف يعمل النظام؟</p>
                <p>
                  عند تفعيل مزود وإدخال بيانات الاعتماد، يظهر زر تسجيل الدخول به تلقائياً في صفحات
                  الدخول والتسجيل.
                </p>
                <p>
                  قيم{" "}
                  <span className="font-mono bg-background/80 px-1 rounded border border-border/60">
                    [SET]
                  </span>{" "}
                  تعني أن القيمة مُعيَّنة مسبقاً — أترك الحقل فارغاً لعدم تغييرها.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Integrations Tab ──────────────────────────────────────────── */}
        {activeTab === "integrations" && canManageSettings && (
          <div role="tabpanel" aria-labelledby="settings-tab-integrations" className="space-y-5">
            <div className="bg-card border border-border/60 rounded-2xl p-6 float-in">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Bot className="w-4.5 h-4.5 text-blue-400" />
                </div>
                <div>
                  <h2 className="font-bold text-sm">تيليجرام</h2>
                  <p className="text-xs text-muted-foreground">إشعارات فورية للمشرفين</p>
                </div>
                <div className="mr-auto">
                  {settings && (
                    <StatusBadge
                      variant={settings.telegram_configured ? "success" : "neutral"}
                      size="xs"
                    >
                      {settings.telegram_configured ? "مفعّل" : "غير مفعّل"}
                    </StatusBadge>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-muted skeleton-shimmer rounded-2xl" />
                  ))}
                </div>
              ) : loadError ? (
                /* R120-B4 (A2-F10): a failed settings load is NOT
                    «غير موجود» per key — the error card names the
                    failure and offers the retry (the old
                    `.catch(() => null)` rendered confidently-wrong
                    rows off a null payload). */
                <div
                  role="alert"
                  className="text-center py-10 text-muted-foreground bg-muted/20 border border-status-error/22 rounded-2xl"
                >
                  <p className="font-bold text-sm mb-1.5 text-foreground/80">
                    تعذّر تحميل حالة التكاملات
                  </p>
                  <p className="text-xs mb-5 max-w-xs mx-auto leading-relaxed">{loadError}</p>
                  <Button
                    onClick={() => void loadSettingsAndProviders()}
                    size="sm"
                    variant="outline"
                  >
                    إعادة المحاولة
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {[
                    {
                      icon: Bot,
                      label: "الحالة العامة",
                      ok: settings?.telegram_configured,
                      okText: "مفعّل ويعمل",
                      failText: "غير مفعّل",
                    },
                    {
                      icon: Key,
                      label: "TELEGRAM_BOT_TOKEN",
                      ok: settings?.telegram_bot_set,
                      okText: "تم الضبط",
                      failText: "غير موجود",
                    },
                    {
                      icon: Hash,
                      label: "TELEGRAM_CHAT_ID",
                      ok: settings?.telegram_chat_set,
                      okText: "تم الضبط",
                      failText: "غير موجود",
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between px-4 py-3 bg-muted/25 border border-border/60 rounded-2xl"
                    >
                      <div className="flex items-center gap-2.5 text-sm">
                        <row.icon className="w-4 h-4 text-muted-foreground" />
                        <span className="font-mono text-xs">{row.label}</span>
                      </div>
                      {/* R126-L5 (A3-4): integrations status text on the
                          --status-success / --status-error ink+tint pair —
                          raw emerald-400 / red-400 measured 1.92 / 2.77:1
                          on the light theme (R125-A3 #8's figures). */}
                      <div
                        className={`flex items-center gap-1.5 text-xs font-bold ${row.ok ? "text-status-success" : "text-status-error"}`}
                      >
                        {row.ok ? (
                          <CheckCircle className="w-3.5 h-3.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        {row.ok ? row.okText : row.failText}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Diagnostic ping ──────────────────────────────────
                  Sends a real test message via the same dispatch path
                  used by production notifications, so the operator
                  gets end-to-end proof of delivery (or a clear error
                  with a hint when something is wrong). */}
              <div className="mt-5 p-4 bg-card border border-border/60 rounded-2xl">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <div className="text-sm font-bold">اختبار التسليم</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      يُرسل رسالة فعلية للمحادثة المُعدّة للتحقق من قابلية وصول البوت.
                    </p>
                  </div>
                  <button
                    onClick={runTelegramTest}
                    disabled={tgTesting}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-bold text-xs transition-all press-spring"
                  >
                    {tgTesting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Bot className="w-3.5 h-3.5" />
                    )}
                    {tgTesting ? "جارٍ الإرسال…" : "اختبار اتصال البوت"}
                  </button>
                </div>

                {tgTestResult && (
                  <div
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${
                      tgTestResult.delivered
                        ? "bg-status-success/10 border-status-success/25 text-status-success"
                        : "bg-status-error/10 border-status-error/25 text-status-error"
                    }`}
                  >
                    {tgTestResult.delivered ? (
                      <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-bold">
                        {tgTestResult.delivered
                          ? "تم التسليم بنجاح"
                          : tgTestResult.configured
                            ? "فشل التسليم"
                            : "النظام غير مُعدّ"}
                      </div>
                      {tgTestResult.errorMessage && (
                        <div className="font-mono text-3xs opacity-90 break-all">
                          {tgTestResult.errorMessage}
                        </div>
                      )}
                      {tgTestResult.hint && (
                        <div className="text-2xs opacity-90 leading-relaxed">
                          {tgTestResult.hint}
                        </div>
                      )}
                      {tgTestResult.attempts > 0 && (
                        <div className="text-3xs opacity-75">
                          عدد المحاولات: {tgTestResult.attempts}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 p-4 bg-muted/30 border border-border/50 rounded-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-bold">كيفية الإعداد</span>
                </div>
                <ol className="space-y-2 text-xs text-muted-foreground leading-relaxed list-none">
                  {[
                    <>
                      أنشئ بوت تيليجرام عبر{" "}
                      {/* R126-L5 (A3-4): inline code tokens on
                          text-primary-text — raw text-primary is 3.76:1
                          on the dark card (A6-B6). */}
                      <span className="font-mono text-primary-text">@BotFather</span> واحصل على
                      التوكن
                    </>,
                    <>
                      أرسل رسالة للبوت ثم افتح{" "}
                      <span className="font-mono text-3xs text-primary-text">
                        api.telegram.org/bot&#123;TOKEN&#125;/getUpdates
                      </span>{" "}
                      للحصول على Chat ID
                    </>,
                    <>
                      أضف <span className="font-mono text-primary-text">TELEGRAM_BOT_TOKEN</span> و{" "}
                      <span className="font-mono text-primary-text">TELEGRAM_CHAT_ID</span> في
                      متغيرات البيئة (Secrets)
                    </>,
                    <>أعد تشغيل الخادم</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-4 h-4 rounded-full bg-muted-foreground/20 text-muted-foreground flex items-center justify-center text-3xs font-bold shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* ── Notifications Tab ─────────────────────────────────────────── */}
        {activeTab === "notifications" && (
          <div
            role="tabpanel"
            aria-labelledby="settings-tab-notifications"
            className="bg-card border border-border/60 rounded-2xl p-6 float-in"
          >
            <h2 className="font-bold mb-1 text-sm">الأحداث التي يتم إشعارك بها</h2>
            {/* R120-B4 (A2-F5): descriptive info panel — the old rows
                rendered a green CheckCircle per event, which read as a
                CONFIGURABLE per-event switch that never was (the
                notification set is fixed server-side). No check icons,
                no per-row status semantics. */}
            <p className="text-xs text-muted-foreground mb-4">
              قائمة إعلامية ثابتة — تُرسل إشعارات تيليجرام للمشرفين عند كل حدث مما يلي
            </p>
            <div className="space-y-2">
              {[
                "تسجيل مستخدم جديد",
                "طلب شحن محفظة جديد",
                "موافقة على طلب شحن",
                "رفض طلب شحن",
                "إتمام طلب شراء جديد",
              ].map((event) => (
                <div
                  key={event}
                  className="flex items-center gap-3 px-4 py-3 bg-muted/20 border border-border/50 rounded-2xl"
                >
                  <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm">{event}</span>
                  <span className="mr-auto text-xs text-muted-foreground">عبر تيليجرام</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Security Tab ──────────────────────────────────────────────── */}
        {activeTab === "security" && (
          <div role="tabpanel" aria-labelledby="settings-tab-security" className="space-y-5">
            <div className="bg-card border border-border/60 rounded-2xl p-6 float-in">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-sm">المصادقة الثنائية (2FA)</h2>
                  <p className="text-xs text-muted-foreground">
                    حماية إضافية لحساب الإدارة الخاص بك
                  </p>
                </div>
              </div>
              <TwoFactorSetup adminToken={adminToken} />
            </div>

            <div className="bg-card border border-border/60 rounded-2xl p-6 float-in delay-75">
              {/* R120-B4 (A2-F5): «حقائق الأمان المطبَّقة» — descriptive
                  info panel. The old checklist hardcoded ok:true on every
                  row and rendered live green CheckCircle ticks: static
                  claims dressed as VERIFIED status. No check icons, no
                  status colors — the facts describe what the deployment
                  uses, nothing claims it was just checked. (R120-B7:
                  «المعمولة» → «المطبَّقة» — the independent review's
                  Arabic-slip fix: «معمولة» is not standard for "in
                  effect".) */}
              <div className="flex items-center gap-2.5 mb-1">
                <Info className="w-4 h-4 text-muted-foreground shrink-0" />
                <h2 className="font-bold text-sm">حقائق الأمان المطبَّقة</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                كيف تعمل طبقة الأمان في هذا النظام — للعلم، وليست إعدادات قابلة للتعديل من هنا
              </p>
              <div className="space-y-3 text-sm text-muted-foreground">
                {[
                  { label: "تشفير الجلسات (JWT)", value: "HS256 — مفتاح عشوائي آمن" },
                  // 94-C2 (A2 P2-7): the backend hashes admin passwords
                  // with argon2 (backend/src/lib/crypto.ts — argon2.hash
                  // with memory-hard options).
                  { label: "تشفير كلمات المرور", value: "Argon2id" },
                  { label: "تحديد معدل الطلبات", value: "20 طلب/15 دق على تسجيل الدخول" },
                  { label: "CORS", value: "مقيّد بنطاقات APP_ORIGINS" },
                  {
                    label: "OAuth Redirect Safety",
                    value: "رمز مؤقت — يُستخدم مرة واحدة",
                  },
                  {
                    label: "Telegram Widget Verify",
                    value: "HMAC-SHA256 + فحص auth_date",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/20 border border-border/50 rounded-2xl"
                  >
                    <div className="flex items-center gap-2.5">
                      <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm">{item.label}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground text-left">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
