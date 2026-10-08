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
import {
  AdminSessionExpiredError,
  adminFetch,
  adminFetchJson,
  isAdminUnauthorized,
} from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
// 93-C7 / C-UX2 (A12 B17): configured/secret/telegram pills migrate
// from raw emerald/yellow hues (+ a square `rounded` on the secret
// chip) to the canonical StatusBadge on the --status-* tokens.
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Bell,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Hash,
  Info,
  Key,
  KeyRound,
  Loader2,
  Save,
  Shield,
  ToggleLeft,
  ToggleRight,
  UserCog,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";

interface TelegramSettings {
  telegram_chat_set: boolean;
  /** Present when API exposes aggregate Telegram readiness */
  telegram_configured?: boolean;
  telegram_bot_set?: boolean;
}

interface ProviderField {
  key: string;
  label: string;
  isSecret: boolean;
  placeholder?: string;
}

interface AuthProvider {
  id: string;
  label: string;
  icon: string;
  color: string;
  auth_type: string;
  description: string;
  setup_url: string;
  fields: ProviderField[];
  enabled: boolean;
  config: Record<string, string>;
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

// ── Provider Icon SVGs ────────────────────────────────────────────────────────

function ProviderIcon({ id }: { id: string }) {
  if (id === "google")
    return (
      <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
        <path
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"
          fill="#4285F4"
        />
        <path
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
          fill="#34A853"
        />
        <path
          d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
          fill="#FBBC05"
        />
        <path
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
          fill="#EA4335"
        />
      </svg>
    );
  if (id === "telegram")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#2AABEE">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
      </svg>
    );
  if (id === "apple")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.54 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
      </svg>
    );
  return <KeyRound className="w-5 h-5 text-muted-foreground" />;
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  adminToken: _adminToken,
  onUpdate,
}: {
  provider: AuthProvider;
  adminToken: string;
  onUpdate: (updated: AuthProvider) => void;
}) {
  const { toast } = useToast();
  const jsonHeaders = useAdminHeaders({ json: true });
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [config, setConfig] = useState<Record<string, string>>(provider.config);
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    await save({ enabled: next, config });
  };

  const save = async (overrides?: { enabled?: boolean; config?: Record<string, string> }) => {
    setSaving(true);
    setError("");
    setSaved(false);
    const body = {
      enabled: overrides?.enabled ?? enabled,
      ...(overrides?.config ?? config),
    };
    try {
      const data = await adminFetchJson<{ enabled?: boolean; config?: Record<string, string> }>(
        `/api/admin/settings/auth/${provider.id}`,
        {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify(body),
        },
        { fallbackError: "فشل الحفظ" },
      );
      const nextConfig = data.config ?? config;
      const nextEnabled = data.enabled ?? enabled;
      setConfig(nextConfig);
      onUpdate({ ...provider, enabled: nextEnabled, config: nextConfig });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      // Roll the optimistic toggle back first (state stays truthful),
      // then stay quiet on session expiry — the global handler already
      // toasted + redirected.
      setEnabled(provider.enabled);
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => save();

  const isConfigured = provider.fields.some((f) => !f.isSecret && !!config[f.key]);

  return (
    <div
      className={`bg-card border rounded-2xl overflow-hidden transition-all ${enabled ? "border-border/60" : "border-border/40 opacity-75"}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3.5 px-5 py-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-muted/60 border border-border/60 shrink-0">
          <ProviderIcon id={provider.id} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{provider.label}</span>
            {isConfigured && (
              <StatusBadge variant="success" size="xs">
                مُعدَّ
              </StatusBadge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{provider.description}</p>
        </div>

        {/* Toggle */}
        <button
          onClick={toggleEnabled}
          disabled={saving}
          className="shrink-0 transition-opacity disabled:opacity-50"
          title={enabled ? "تعطيل المزود" : "تفعيل المزود"}
          aria-label={enabled ? `تعطيل مزود ${provider.label}` : `تفعيل مزود ${provider.label}`}
          aria-pressed={enabled}
        >
          {enabled ? (
            <ToggleRight className="w-8 h-8 text-primary" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-muted-foreground" />
          )}
        </button>

        {/* Expand */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground shrink-0"
          aria-label={
            expanded ? `إخفاء إعدادات ${provider.label}` : `إظهار إعدادات ${provider.label}`
          }
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="border-t border-border/60 px-5 py-4 space-y-4">
          {/* Fields */}
          <div className="space-y-3">
            {provider.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  {field.label}
                  {field.isSecret && (
                    <StatusBadge variant="warning" size="xs">
                      سري
                    </StatusBadge>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={field.isSecret && !showSecret[field.key] ? "password" : "text"}
                    value={config[field.key] ?? ""}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={
                      config[field.key] === "[SET]"
                        ? "••••••••••• (مُعيَّن)"
                        : (field.placeholder ?? "")
                    }
                    dir="ltr"
                    className="w-full bg-background border border-border/70 rounded-lg px-3 py-2 text-sm font-mono text-left outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground pr-9"
                  />
                  {field.isSecret && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowSecret((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                      }
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors"
                      aria-label={
                        showSecret[field.key]
                          ? `إخفاء قيمة حقل ${field.label}`
                          : `إظهار قيمة حقل ${field.label}`
                      }
                    >
                      {showSecret[field.key] ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Callback URL hint for OAuth providers */}
          {provider.auth_type === "oauth_redirect" && (
            <div className="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/15 rounded-lg">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-bold text-blue-400">Callback URL للإعداد في لوحة المطور</p>
                <code className="block font-mono text-2xs bg-background/60 px-2 py-1 rounded border border-border/40 text-foreground/80 break-all">
                  {window.location.origin}/api/auth/{provider.id}/callback
                </code>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-bold text-sm hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ الحفظ...
                </>
              ) : saved ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" /> تم الحفظ
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" /> حفظ التغييرات
                </>
              )}
            </button>

            <a
              href={provider.setup_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              دليل الإعداد
            </a>

            {error && <span className="text-xs text-destructive mr-auto">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 2FA Setup Component ────────────────────────────────────────────────────────

function TwoFactorSetup({ adminToken: _adminToken }: { adminToken: string }) {
  const headers = useAdminHeaders();
  const jsonHeaders = useAdminHeaders({ json: true });
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauth_url: string;
    qrCode?: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const startSetup = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminFetchJson<{
        secret: string;
        otpauth_url: string;
      }>("/api/admin/2fa/setup", {
        method: "POST",
        headers,
      });

      import("qrcode").then((QRCode) => {
        QRCode.default.toDataURL(data.otpauth_url, (err: Error | null, url: string) => {
          if (!err) setSetupData({ ...data, qrCode: url });
        });
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  };

  const verifySetup = async () => {
    setLoading(true);
    setError("");
    try {
      await adminFetchJson("/api/admin/2fa/verify-setup", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ code }),
      });

      setSuccess(true);
      setSetupData(null);
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-6 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
        <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
        <h3 className="font-bold text-emerald-500">تم تفعيل المصادقة الثنائية بنجاح</h3>
        <p className="text-sm text-emerald-500/80 mt-1">حسابك الآن محمي بطبقة إضافية من الأمان.</p>
      </div>
    );
  }

  if (setupData) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row items-center gap-6 p-6 bg-muted/20 border border-border/50 rounded-xl">
          <div className="shrink-0 bg-white p-3 rounded-xl shadow-sm">
            {setupData.qrCode ? (
              <img src={setupData.qrCode} alt="QR Code" className="w-32 h-32" />
            ) : (
              // QR is generated client-side after the backend mints the
              // 2FA secret — usually <100ms, but on slow devices the
              // tile can briefly read empty. A subtle skeleton tile
              // (no spinner) matches the rest of the loading system.
              <div className="w-32 h-32 skeleton-shimmer rounded-md" aria-busy="true" />
            )}
          </div>
          <div className="flex-1 space-y-3">
            <h3 className="font-bold text-sm">1. امسح رمز الاستجابة السريعة</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              افتح تطبيق Google Authenticator أو Authy وامسح الرمز ضوئياً. إذا كنت لا تستطيع مسح
              الرمز، أدخل المفتاح التالي يدوياً:
            </p>
            <code className="block bg-background px-3 py-2 rounded-lg border border-border/50 font-mono text-sm tracking-wider text-center">
              {setupData.secret}
            </code>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-bold text-sm">2. أدخل رمز التحقق</h3>
          <p className="text-xs text-muted-foreground">
            أدخل الرمز المكون من 6 أرقام الذي يظهر في تطبيق المصادقة.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              /* 96-F7 (R96 M6): numeric keypad on mobile for the 6-digit
                 TOTP verification code (+ one-time-code autocomplete so
                 authenticator apps can offer to fill it) — Android
                 opened a full QWERTY keyboard on every setup. */
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              dir="ltr"
              className="w-full max-w-[200px] h-11 bg-background border border-border/70 rounded-xl px-4 text-center text-lg tracking-widest font-mono focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
            />
            <button
              onClick={verifySetup}
              disabled={code.length !== 6 || loading}
              className="h-11 px-6 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "تفعيل"}
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        المصادقة الثنائية (2FA) تضيف طبقة أمان إضافية لحسابك. عند تسجيل الدخول، ستحتاج إلى إدخال رمز
        التحقق من تطبيق مثل Google Authenticator.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        onClick={startSetup}
        disabled={loading}
        className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary/10 text-primary font-bold text-sm hover:bg-primary/20 transition-all border border-primary/20"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
        إعداد المصادقة الثنائية
      </button>
    </div>
  );
}

// ── Account Tab ───────────────────────────────────────────────────────────────
//
// Self-contained account-management surface. Fetches the current admin's
// session metadata on mount and exposes two re-auth-gated forms:
//   1. profile update (username + display name)
//   2. password change (current + new + confirm)
// Both re-require the CURRENT password before any change goes through —
// even though the request itself is already cookie-authenticated. This is
// the standard "sudo" pattern for high-leverage credential changes.

interface AdminSession {
  id: number;
  username: string;
  display_name: string;
  role: string;
  totp_enabled: boolean;
  created_at?: string;
}

function AccountTab({ adminToken: _adminToken }: { adminToken: string }) {
  const { toast } = useToast();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const headers = useAdminHeaders({ json: true });

  useEffect(() => {
    // R123 (E3 item 1): adminFetch for uniformity — the session endpoint
    // is response-exempt in the global 401 handler, so behavior is
    // byte-identical to the raw fetch (reject-on-!ok → null session).
    adminFetch("/api/admin/session", { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [headers]);

  // ── Profile (username + display name) form state ──
  const [profileUsername, setProfileUsername] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    if (session) {
      setProfileUsername(session.username);
      setProfileDisplayName(session.display_name);
    }
  }, [session]);

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profilePassword) {
      toast({ title: "كلمة المرور الحالية مطلوبة لتأكيد التغيير", variant: "destructive" });
      return;
    }
    setProfileSaving(true);
    try {
      const body = await adminFetchJson<Partial<AdminSession>>(
        "/api/admin/profile",
        {
          method: "PATCH",
          credentials: "include",
          headers,
          body: JSON.stringify({
            username: profileUsername.trim(),
            display_name: profileDisplayName.trim(),
            current_password: profilePassword,
          }),
        },
        { fallbackError: "فشل التحديث" },
      );
      setSession((s) => (s ? { ...s, ...body } : s));
      setProfilePassword("");
      toast({ title: "تم تحديث بيانات الحساب" });
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل التحديث",
        variant: "destructive",
      });
    } finally {
      setProfileSaving(false);
    }
  };

  // ── Password form state ──
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwShowNew, setPwShowNew] = useState(false);

  // 98-F7 (R98-05): dirty-state guard — the account tab hosts two long
  // forms (profile + password). Any un-submitted edit now arms the
  // browser beforeunload prompt, so a refresh / tab close mid-edit asks
  // before discarding (SPA route-leave interception stays a documented
  // residual — see use-dirty-guard.ts). Manual field compare vs the
  // loaded session (cheap — three strings + three password fields).
  const accountDirty =
    (!!session &&
      (profileUsername !== session.username ||
        profileDisplayName !== session.display_name ||
        profilePassword !== "")) ||
    pwCurrent !== "" ||
    pwNew !== "" ||
    pwConfirm !== "";
  useDirtyGuard(accountDirty);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwNew !== pwConfirm) {
      toast({ title: "كلمتا المرور الجديدتان غير متطابقتان", variant: "destructive" });
      return;
    }
    if (pwNew.length < 8) {
      toast({ title: "كلمة المرور يجب أن تكون 8 أحرف على الأقل", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      await adminFetchJson(
        "/api/admin/change-password",
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
        },
        { fallbackError: "فشل تغيير كلمة المرور" },
      );
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
      toast({ title: "تم تغيير كلمة المرور بنجاح" });
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: err instanceof Error ? err.message : "فشل تغيير كلمة المرور",
        variant: "destructive",
      });
    } finally {
      setPwSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 py-2" aria-busy="true">
        <div className="h-5 w-40 skeleton-shimmer rounded-lg" />
        <div className="h-4 w-64 skeleton-shimmer rounded" />
        <div className="h-10 skeleton-shimmer rounded-xl mt-2" />
        <div className="h-10 skeleton-shimmer rounded-xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-sm text-muted-foreground py-8">
        {/* R120-B4 (A2-F21): typo fix — تعذّر (with shadda), the
            spelling used everywhere else in the admin copy. */}
        تعذّر تحميل بيانات الحساب. حاول إعادة تسجيل الدخول.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Identity card */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-3 float-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <UserCog className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-lg">{session.display_name}</div>
            <div className="text-xs text-muted-foreground">@{session.username}</div>
          </div>
          <div className="text-3xs font-bold uppercase bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded-full">
            {session.role}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2 border-t border-border/40">
          <div>
            <span className="block text-foreground/50">المصادقة الثنائية</span>
            <span className="font-bold text-foreground">
              {session.totp_enabled ? "✓ مفعّلة" : "غير مفعّلة"}
            </span>
          </div>
          {session.created_at && (
            <div>
              <span className="block text-foreground/50">تاريخ الإنشاء</span>
              <span className="font-bold text-foreground">
                {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits —
                    engines without ar-LY data fall back to the "ar" root
                    and emit Arabic-Indic numerals otherwise. */}
                {new Date(session.created_at).toLocaleDateString("ar-LY-u-nu-latn", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Profile form */}
      <form
        onSubmit={submitProfile}
        className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 float-in"
      >
        <div>
          <h3 className="font-bold text-base mb-1">بيانات الحساب</h3>
          <p className="text-xs text-muted-foreground">
            تحديث اسم المستخدم والاسم الظاهر. يُطلب تأكيد كلمة المرور الحالية.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="settings-f1-17486" className="text-xs font-bold mb-1 block">
              اسم المستخدم
            </label>
            <input
              id="settings-f1-17486"
              type="text"
              value={profileUsername}
              onChange={(e) => setProfileUsername(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
              minLength={3}
              maxLength={100}
              required
            />
          </div>
          <div>
            <label htmlFor="settings-f2-17484" className="text-xs font-bold mb-1 block">
              الاسم الظاهر
            </label>
            <input
              id="settings-f2-17484"
              type="text"
              value={profileDisplayName}
              onChange={(e) => setProfileDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
              maxLength={100}
            />
          </div>
        </div>
        <div>
          <label htmlFor="settings-f3-38230" className="text-xs font-bold mb-1 block">
            كلمة المرور الحالية للتأكيد
          </label>
          <input
            id="settings-f3-38230"
            type="password"
            value={profilePassword}
            onChange={(e) => setProfilePassword(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            autoComplete="current-password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={profileSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {profileSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ الحفظ…
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" /> حفظ التغييرات
            </>
          )}
        </button>
      </form>

      {/* Password form */}
      <form
        onSubmit={submitPassword}
        className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 float-in"
      >
        <div>
          <h3 className="font-bold text-base mb-1">تغيير كلمة المرور</h3>
          <p className="text-xs text-muted-foreground">
            8 أحرف على الأقل. لن يتم إنهاء الجلسات الحالية الأخرى.
          </p>
        </div>
        <div>
          <label htmlFor="settings-f4-27077" className="text-xs font-bold mb-1 block">
            كلمة المرور الحالية
          </label>
          <input
            id="settings-f4-27077"
            type="password"
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="settings-f5-27063" className="text-xs font-bold mb-1 block">
              كلمة المرور الجديدة
            </label>
            <div className="relative">
              <input
                id="settings-f5-27063"
                type={pwShowNew ? "text" : "password"}
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                className="w-full px-3 py-2 pr-9 bg-background border border-border/60 rounded-lg text-sm"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setPwShowNew((v) => !v)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={pwShowNew ? "إخفاء" : "إظهار"}
              >
                {pwShowNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="settings-f6-35008" className="text-xs font-bold mb-1 block">
              تأكيد كلمة المرور الجديدة
            </label>
            <input
              id="settings-f6-35008"
              type={pwShowNew ? "text" : "password"}
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={pwSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {pwSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ التحديث…
            </>
          ) : (
            <>
              <Key className="w-3.5 h-3.5" /> تحديث كلمة المرور
            </>
          )}
        </button>
      </form>
    </div>
  );
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
        <div className="flex flex-wrap gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1 w-fit">
          {/* R123 (E3 P3f): auth + integrations render only for
              settings-scoped admins (the tabAllowed gate above). */}
          {TABS.filter((tab) => tabAllowed(tab.id, canManageSettings)).map((tab) => (
            <button
              key={tab.id}
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
        {(activeTab === "auth" || activeTab === "integrations") && !canManageSettings && (
          <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
            إدارة المصادقة والتكاملات تتطلب صلاحية الإعدادات — تواصل مع مسؤول النظام
          </p>
        )}

        {/* ── Account Tab ─────────────────────────────────────────────── */}
        {activeTab === "account" && adminToken && <AccountTab adminToken={adminToken} />}

        {/* ── Auth Providers Tab ─────────────────────────────────────────── */}
        {activeTab === "auth" && canManageSettings && (
          <div className="space-y-5">
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
                  {enabledCount === 0
                    ? "لا توجد طرق مفعّلة — سيظهر للمستخدمين الدخول برقم الهاتف (رمز تحقق) فقط"
                    : `${enabledCount} طريقة مفعّلة إضافةً إلى الدخول برقم الهاتف (رمز تحقق)`}
                </div>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full border ${enabledCount > 0 ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border"}`}
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
          <div className="space-y-5">
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
                      <div
                        className={`flex items-center gap-1.5 text-xs font-bold ${row.ok ? "text-emerald-400" : "text-red-400"}`}
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
                      <span className="font-mono text-primary">@BotFather</span> واحصل على التوكن
                    </>,
                    <>
                      أرسل رسالة للبوت ثم افتح{" "}
                      <span className="font-mono text-3xs text-primary">
                        api.telegram.org/bot&#123;TOKEN&#125;/getUpdates
                      </span>{" "}
                      للحصول على Chat ID
                    </>,
                    <>
                      أضف <span className="font-mono text-primary">TELEGRAM_BOT_TOKEN</span> و{" "}
                      <span className="font-mono text-primary">TELEGRAM_CHAT_ID</span> في متغيرات
                      البيئة (Secrets)
                    </>,
                    <>أعد تشغيل السيرفر</>,
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
          <div className="bg-card border border-border/60 rounded-2xl p-6 float-in">
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
          <div className="space-y-5">
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
                    value: "كود مؤقت — يُستخدم مرة واحدة",
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

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
