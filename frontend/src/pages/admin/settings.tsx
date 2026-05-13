import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
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
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
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
  { id: "auth", label: "المصادقة", icon: KeyRound },
  { id: "integrations", label: "التكاملات", icon: Bot },
  { id: "notifications", label: "الإشعارات", icon: Bell },
  { id: "security", label: "الأمان", icon: Shield },
];

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
  if (id === "github")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    );
  if (id === "facebook")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
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
  adminToken,
  onUpdate,
}: {
  provider: AuthProvider;
  adminToken: string;
  onUpdate: (updated: AuthProvider) => void;
}) {
  const { toast } = useToast();
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
      const res = await fetch(`/api/admin/settings/auth/${provider.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        enabled?: boolean;
        config?: Record<string, string>;
      };
      if (!res.ok) throw new Error(data.error ?? "فشل الحفظ");
      const nextConfig = data.config ?? config;
      const nextEnabled = data.enabled ?? enabled;
      setConfig(nextConfig);
      onUpdate({ ...provider, enabled: nextEnabled, config: nextConfig });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
      setEnabled(provider.enabled);
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
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                مُعدَّ
              </span>
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
                    <span className="text-[10px] bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 px-1.5 py-0.5 rounded font-bold">
                      سري
                    </span>
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
                <code className="block font-mono text-[11px] bg-background/60 px-2 py-1 rounded border border-border/40 text-foreground/80 break-all">
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

function TwoFactorSetup({ adminToken }: { adminToken: string }) {
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
      const res = await fetch("/api/admin/2fa/setup", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "حدث خطأ أثناء الإعداد");

      import("qrcode").then((QRCode) => {
        QRCode.default.toDataURL(data.otpauth_url, (err: Error | null, url: string) => {
          if (!err) setSetupData({ ...data, qrCode: url });
        });
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  };

  const verifySetup = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/2fa/verify-setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "رمز التحقق غير صحيح");

      setSuccess(true);
      setSetupData(null);
    } catch (err: unknown) {
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
              <div className="w-32 h-32 flex items-center justify-center bg-muted">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("auth");

  useEffect(() => {
    if (!adminToken) return;
    const headers = { Authorization: `Bearer ${adminToken}` };

    Promise.all([
      fetch("/api/admin/settings", { headers })
        .then((r) => r.json())
        .catch(() => null),
      fetch("/api/admin/settings/auth", { headers })
        .then((r) => r.json())
        .catch(() => ({ providers: [] })),
    ])
      .then(([sysSettings, authData]) => {
        if (sysSettings) setSettings(sysSettings);
        if (authData?.providers) setProviders(authData.providers);
      })
      .finally(() => setLoading(false));
  }, [adminToken]);

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const enabledCount = providers.filter((p) => p.enabled).length;

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-black mb-0.5">الإعدادات</h1>
          <p className="text-muted-foreground text-sm">
            إعدادات النظام والتكاملات وإدارة طرق المصادقة
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${activeTab === tab.id ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Auth Providers Tab ─────────────────────────────────────────── */}
        {activeTab === "auth" && (
          <div className="space-y-5">
            {/* Summary banner */}
            <div className="flex items-center gap-3 px-5 py-3.5 bg-card border border-border/60 rounded-2xl float-in">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-sm">طرق تسجيل الدخول</div>
                <div className="text-xs text-muted-foreground">
                  {enabledCount === 0
                    ? "لا توجد طرق مفعّلة — سيظهر للمستخدمين الهاتف وكلمة المرور فقط"
                    : `${enabledCount} طريقة مفعّلة إضافةً إلى الهاتف/كلمة المرور`}
                </div>
              </div>
              <span
                className={`text-xs font-black px-2.5 py-1 rounded-full border ${enabledCount > 0 ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border"}`}
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
        {activeTab === "integrations" && (
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
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full border ${settings.telegram_configured ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}
                    >
                      {settings.telegram_configured ? "مفعّل" : "غير مفعّل"}
                    </span>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-muted skeleton-shimmer rounded-2xl" />
                  ))}
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
                      <span className="font-mono text-[10px] text-primary">
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
                      <span className="w-4 h-4 rounded-full bg-muted-foreground/20 text-muted-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
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
            <h2 className="font-bold mb-4 text-sm">الأحداث التي يتم إشعارك بها</h2>
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
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
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
              <h2 className="font-bold mb-4 text-sm">إعدادات الأمان</h2>
              <div className="space-y-3 text-sm text-muted-foreground">
                {[
                  { label: "تشفير JWT", value: "HS256 — مفتاح عشوائي آمن", ok: true },
                  { label: "تشفير كلمات المرور", value: "SHA-256 + salt", ok: true },
                  { label: "تحديد معدل الطلبات", value: "20 طلب/15 دق على تسجيل الدخول", ok: true },
                  { label: "CORS", value: "مقيّد بنطاقات APP_ORIGINS", ok: true },
                  {
                    label: "OAuth Redirect Safety",
                    value: "كود مؤقت — يُستخدم مرة واحدة",
                    ok: true,
                  },
                  {
                    label: "Telegram Widget Verify",
                    value: "HMAC-SHA256 + فحص auth_date",
                    ok: true,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between px-4 py-3 bg-muted/20 border border-border/50 rounded-2xl"
                  >
                    <div className="flex items-center gap-2.5">
                      <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{item.value}</span>
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    </div>
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
