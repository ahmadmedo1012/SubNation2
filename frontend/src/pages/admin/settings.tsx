import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/Skeleton";
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
import {
  AdminSessionExpiredError,
  adminFetch,
  adminFetchJson,
  isAdminUnauthorized,
} from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { Bell, Bot, Info, KeyRound, Shield, UserCog } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";
// R126-L9 (A3 split plan D): the three tab surfaces moved to
// ./settings/* modules (byte-move, zero behavior change) — this file
// stays the route entry (App.tsx lazy-imports it) and owns the tab
// shell, the ?tab= URL contract, and the scope gate.
import { AccountTab } from "./settings/account-tab";
import { type AuthProvider } from "./settings/provider-card";
import { TwoFactorSetup } from "./settings/two-factor-setup";
// R137 (FE decomposition): the page's remaining presentational
// sections + the shell's pure metadata moved to
// @/components/admin/settings-page/* (verbatim moves — the mutation
// path stays HERE: the settings/providers fetch pair
// (loadSettingsAndProviders + fetchJsonOrNull with the R120-B4
// 401-sentinel), runTelegramTest (the diagnostic POST with its
// session-expiry quiet-catch), selectTab + the ?tab= URL contract and
// every settings/providers atom; the extracts render the byte-identical
// DOM they rendered inline yesterday). Import surface:
//   • settings-page-meta — the pure module (tabAllowed scope gate,
//     TelegramSettings/TelegramTestResult contracts)
//   • SettingsTabBar — the R124-I5 real-tab tablist (the pre-filtered
//     tab list + activeTab + selectTab ride down)
//   • AuthProvidersSummary / AuthProvidersList / AuthHowItWorksInfo —
//     the «المصادقة» tab's banner, provider stack and info box
//   • TelegramCardHeader / TelegramStatusRows / TelegramDiagnosticPing /
//     TelegramSetupGuide — the «التكاملات» tab's telegram card
//   • NotificationsTabPanel — the static «الإشعارات» pane
// The SkeletonText loading branches + the two retry error cards stay
// inline (the skeleton-primitives adoption-floor pin reads this file's
// import), and so does the whole «الأمان» pane (the TwoFactorSetup
// mount + the settings-security-facts-copy source pin).
import {
  tabAllowed,
  type TelegramSettings,
  type TelegramTestResult,
} from "@/components/admin/settings-page/settings-page-meta";
import { SettingsTabBar } from "@/components/admin/settings-page/SettingsTabBar";
import { AuthProvidersSummary } from "@/components/admin/settings-page/AuthProvidersSummary";
import { AuthProvidersList } from "@/components/admin/settings-page/AuthProvidersList";
import { AuthHowItWorksInfo } from "@/components/admin/settings-page/AuthHowItWorksInfo";
import { TelegramCardHeader } from "@/components/admin/settings-page/TelegramCardHeader";
import { TelegramStatusRows } from "@/components/admin/settings-page/TelegramStatusRows";
import { TelegramDiagnosticPing } from "@/components/admin/settings-page/TelegramDiagnosticPing";
import { TelegramSetupGuide } from "@/components/admin/settings-page/TelegramSetupGuide";
import { NotificationsTabPanel } from "@/components/admin/settings-page/NotificationsTabPanel";

const TABS = [
  { id: "account", label: "حسابي", icon: UserCog },
  { id: "auth", label: "المصادقة", icon: KeyRound },
  { id: "integrations", label: "التكاملات", icon: Bot },
  { id: "notifications", label: "الإشعارات", icon: Bell },
  { id: "security", label: "الأمان", icon: Shield },
];

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
  const [tgTestResult, setTgTestResult] = useState<TelegramTestResult | null>(null);

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
        // R148 (3-errcopy): route through getErrorMessage — a network-
        // level English message ("Failed to fetch", the timeout
        // DOMException) collapses to Arabic instead of landing raw in
        // the diagnostic row; Arabic server messages pass through.
        errorMessage: getErrorMessage(err),
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
    // D-1/D-3 (R142): adminFetch = the session-aware wrapper + the 20 s
    // app-wide timeout contract — this was the one settings fetch still on
    // a bare fetch (the header comment claimed otherwise). The local
    // ok-guard + "__unauthorized__" sentinel below stay (decomposition
    // pin); an expired-session 401 now arrives as
    // AdminSessionExpiredError from adminFetch itself.
    const res = await adminFetch(url, { headers: adminHeaders });
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
      // N-4 (R142): the backend emits EXACTLY {telegram_configured,
      // platform_name, currency, maintenance_mode}
      // (backend/src/routes/admin/settings.ts:15-22) — the legacy local
      // type's telegram_bot_set / telegram_chat_set were NEVER emitted, so
      // the two key rows read undefined and permanently rendered
      // «غير موجود». TelegramSettings now mirrors the real 4-field
      // contract; the shape gate keeps a garbage 200 out of the rows.
      if (
        sysSettings &&
        typeof sysSettings.telegram_configured === "boolean" &&
        typeof sysSettings.platform_name === "string" &&
        typeof sysSettings.currency === "string" &&
        typeof sysSettings.maintenance_mode === "boolean"
      ) {
        setSettings(sysSettings as unknown as TelegramSettings);
      }
      if (authData && Array.isArray(authData.providers))
        setProviders(authData.providers as AuthProvider[]);
    } catch (err) {
      // D-1 (R142): adminFetch throws this AFTER the global handler has
      // toasted + redirected — stay quiet locally (runTelegramTest's
      // quiet-catch idiom).
      if (err instanceof AdminSessionExpiredError) {
        setLoading(false);
        return;
      }
      if (err instanceof Error && err.message === "__unauthorized__") {
        // The global 401 handler toasted + redirected — nothing local.
        setLoading(false);
        return;
      }
      // R148 (3-errcopy): the raw extractor leaked network-level
      // English ("Failed to fetch") into the Arabic error cards —
      // getErrorMessage passes the wrapper's already-Arabic messages
      // through and collapses technical English to the Arabic generic.
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // R182 (Lane-B defect 1): the fetch pair is settings-scoped
    // server-side (GET /api/admin/settings + /api/admin/settings/auth) —
    // firing it for every authenticated admin meant a synchronized 403
    // pair on every visit for scope-less admins (the R134 A3-F1 "403
    // burst" class, fixed on 14 other pages; this page's tabs hid but
    // the mount fetch never got the gate). The account/notifications/
    // security tabs are self-service and never read this state.
    if (adminToken && canManageSettings) void loadSettingsAndProviders();
    else setLoading(false);
    // Mount-only by design (mirrors the original effect): adminHeaders
    // is referentially stable per session (useAdminHeaders rides a
    // useMemo), so depending on the per-render closure would refetch
    // for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, canManageSettings]);

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
          <h1 className="text-xl font-bold mb-0.5">الإعدادات</h1>
          <p className="text-muted-foreground text-sm">
            إعدادات النظام والتكاملات وإدارة طرق المصادقة
          </p>
        </div>

        {/* Tab bar */}
        {/* R124-I5 (A6 F10): real tab semantics — the five content panes
            made the active tab purely visual for assistive tech. The bar
            is a tablist; each button is a tab with aria-selected; each
            pane below carries role="tabpanel" + aria-labelledby. */}
        {/* R123 (E3 P3f): auth + integrations render only for
            settings-scoped admins (the tabAllowed gate). */}
        <SettingsTabBar
          tabs={TABS.filter((tab) => tabAllowed(tab.id, canManageSettings))}
          activeTab={activeTab}
          onSelect={selectTab}
        />

        {/* R123 (E3 P3f): the scope-honest fallback (canEditMoney idiom)
            — only reachable via a stale local activeTab, never via the
            tab bar or a deep link (both respect tabAllowed). */}
        {/* R126-L5 (A3-4): the scope-gate banner rides the
            --status-warning ink+tint pair — raw amber-500 on its /10
            tint measured 1.99:1 on the light theme (A6-B4's figure);
            the token measures 6.04:1 on white / 5.09:1 on the /12 tint
            light and ≥9:1 dark (index.css F3-06). */}
        {/* R139 (precision): the banner edge joins the shared
            AdminScopeGate's canonical /30 (139-d verified + pinned that
            register this round) — this page's /25 was the lone softer
            outlier among the scope-gate family. */}
        {(activeTab === "auth" || activeTab === "integrations") && !canManageSettings && (
          <p className="text-xs text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
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
            <AuthProvidersSummary enabledCount={enabledCount} providersCount={providers.length} />

            {loading ? (
              /* R136 (UX-1): SkeletonText — the 3-row provider stack,
                 geometry verbatim; the pair is net-new. */
              <SkeletonText
                count={3}
                wrapperClassName="space-y-3"
                className="h-16 rounded-2xl"
                lastShorter={false}
              />
            ) : loadError ? (
              /* R120-B4 (A2-F10): the shared error-card idiom — a failed
                  providers load is NOT an empty provider list. */
              /* R139 (precision): the frame joins the r138 calm-error
                 register (139-d's ChartErrorBanner / the FetchErrorCard
                 re-tune): the status-error/22 edge retires for the card
                 family's resting border-border/60 — severity lives in
                 the CONTENT (role="alert" + the bold «تعذّر» headline +
                 the retry), not a red frame around the card. */
              <div
                role="alert"
                className="text-center py-10 text-muted-foreground bg-card border border-border/60 rounded-2xl"
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
              <AuthProvidersList
                providers={providers}
                adminToken={adminToken}
                onUpdateProvider={(updated) =>
                  setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                }
              />
            )}

            {/* Info box */}
            <AuthHowItWorksInfo />
          </div>
        )}

        {/* ── Integrations Tab ──────────────────────────────────────────── */}
        {activeTab === "integrations" && canManageSettings && (
          <div role="tabpanel" aria-labelledby="settings-tab-integrations" className="space-y-5">
            <div className="bg-card border border-border/60 rounded-2xl p-6 float-in">
              <TelegramCardHeader settings={settings} />

              {loading ? (
                /* R136 (UX-1): SkeletonText — the 3-row settings stack
                   (bg-muted tint rides along), geometry verbatim. */
                <SkeletonText
                  count={3}
                  wrapperClassName="space-y-2"
                  className="h-12 bg-muted rounded-2xl"
                  lastShorter={false}
                />
              ) : loadError ? (
                /* R120-B4 (A2-F10): a failed settings load is NOT
                    «غير موجود» per key — the error card names the
                    failure and offers the retry (the old
                    `.catch(() => null)` rendered confidently-wrong
                    rows off a null payload). */
                /* R139 (precision): same calm-error frame swap as the
                   «المصادقة» twin above — border-border/60 on the inset
                   tile (bg-muted/20 stays: the card nests inside the
                   p-6 integrations card, a bg-card fill would vanish
                   against its parent). */
                <div
                  role="alert"
                  className="text-center py-10 text-muted-foreground bg-muted/20 border border-border/60 rounded-2xl"
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
                <TelegramStatusRows settings={settings} />
              )}

              <TelegramDiagnosticPing
                tgTesting={tgTesting}
                tgTestResult={tgTestResult}
                onRunTest={runTelegramTest}
              />

              <TelegramSetupGuide />
            </div>
          </div>
        )}

        {/* ── Notifications Tab ─────────────────────────────────────────── */}
        {activeTab === "notifications" && <NotificationsTabPanel />}

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
              {/* R187 (C-F8): the dead adminToken prop dropped — headers
                  come from useAdminHeaders inside the component. */}
              <TwoFactorSetup />
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
                    <span className="text-xs font-mono text-muted-foreground text-end">
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
