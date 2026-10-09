/**
 * Auth-provider configuration card (R126-L9 split, A3 plan D).
 *
 * Extracted verbatim from pages/admin/settings.tsx — the per-provider
 * card rendered in the settings page's «المصادقة» tab: the optimistic
 * enable-toggle (rolled back on failure), the expandable credential
 * form ([SET] masking for secrets), the OAuth callback-URL hint, and
 * the save/setup-guide actions. Byte-move: no behavior, prop, or copy
 * change; see A3's split plan D for the boundary rationale.
 */
import { useAdminHeaders } from "@/hooks/use-admin-headers";
// 93-C7 / C-UX2 (A12 B17): configured/secret/telegram pills migrate
// from raw emerald/yellow hues (+ a square `rounded` on the secret
// chip) to the canonical StatusBadge on the --status-* tokens.
import { StatusBadge } from "@/components/ui/status-badge";
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Save,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useState } from "react";

// R127-B2 (§B.3): the R126-L9 split left `export` on module-private
// symbols — keyword dropped; zero behavior change.
interface ProviderField {
  key: string;
  label: string;
  isSecret: boolean;
  placeholder?: string;
}

export interface AuthProvider {
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

export function ProviderCard({
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
      // B14-14 (R127-L11): the inline error span below is the card's
      // designed affordance but was dead — `error` was only ever
      // cleared, never set, so save failures surfaced ONLY via the
      // toast. The catch now feeds the same Arabic message
      // (adminFetchJson maps the body via getErrorMessage; the
      // `fallbackError: "فشل الحفظ"` covers message-less bodies) to
      // both channels. `setError("")` at save() start keeps every
      // retry clean.
      const message = err instanceof Error ? err.message : "فشلت العملية";
      setError(message);
      toast({
        title: "خطأ",
        description: message,
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
          {/* R126-L5 (A3-4): ink+tint pair on the --status-info token —
              raw blue-400 measured ≈2.9:1 on the light theme (A3);
              --status-info is AA-tuned both themes (6.48:1 on white,
              5.43:1 on its /12 tint — index.css R116-S1 figures). */}
          {provider.auth_type === "oauth_redirect" && (
            <div className="flex items-start gap-2 p-3 bg-status-info/5 border border-status-info/15 rounded-lg">
              <Info className="w-3.5 h-3.5 text-status-info shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-bold text-status-info">Callback URL للإعداد في لوحة المطور</p>
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
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ الحفظ…
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
