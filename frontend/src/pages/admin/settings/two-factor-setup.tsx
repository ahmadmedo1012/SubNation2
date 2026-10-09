/**
 * 2FA (TOTP) enrollment + rotation flow (R126-L9 split, A3 plan D).
 *
 * Extracted verbatim from pages/admin/settings.tsx — the security tab's
 * self-service surface: the fresh-enrollment flow (setup → QR → verify),
 * the enrolled probe (/api/admin/session's totp_enabled) with the
 * «مفعّلة» status card, and the current-password re-auth gate that the
 * backend's S5 change requires to rotate an enabled secret. Byte-move:
 * no behavior, prop, or copy change; see A3's split plan D.
 */
import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { AdminSessionExpiredError, adminFetch, adminFetchJson } from "@/lib/admin-session";
import { CheckCircle, Loader2, RefreshCw, Shield, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export function TwoFactorSetup({ adminToken: _adminToken }: { adminToken: string }) {
  const headers = useAdminHeaders();
  const jsonHeaders = useAdminHeaders({ json: true });
  // R125-I5 (A3-1 P2): the component used to be mounted unconditionally
  // with the same «إعداد المصادقة الثنائية» CTA for every admin — an
  // already-enrolled admin clicked it and hit the backend's S5 gate
  // (93-A1: POST /2fa/setup requires current_password whenever TOTP is
  // already enabled, because rotating an enabled secret DISABLES 2FA
  // until the new one is verified) with a guaranteed 400 and no path
  // forward. The component now knows the enrollment state and grows an
  // honest rotate flow: a «مفعّلة» status card + a current-password
  // re-auth gate (the same sudo pattern /profile + /change-password
  // already enforce) that sends `current_password` on the setup POST.
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [showRotate, setShowRotate] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauth_url: string;
    qrCode?: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // R125-I5 (A3-1): fetch the session's totp_enabled once on mount
    // (the AccountTab idiom — response-exempt endpoint, reject-on-!ok).
    // A failed probe leaves `enrolled` null: the fresh-enrollment branch
    // renders, and if the operator is actually enrolled the backend's
    // gate 400 below flips this component into the rotate flow instead
    // of dead-ending.
    let cancelled = false;
    adminFetch("/api/admin/session", { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((s: { totp_enabled?: boolean }) => {
        if (!cancelled) setEnrolled(s.totp_enabled === true);
      })
      .catch(() => {
        if (!cancelled) setEnrolled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [headers]);

  const startSetup = async () => {
    // R125-I5 (A3-1): the S5 gate is client-visible too — an enrolled
    // admin never fires the bodyless POST the backend must 400.
    if (enrolled && !currentPassword) {
      setError("كلمة المرور الحالية مطلوبة لإعادة إعداد المصادقة الثنائية");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await adminFetchJson<{
        secret: string;
        otpauth_url: string;
      }>("/api/admin/2fa/setup", {
        method: "POST",
        // R125-I5: the rotate path presents the re-auth password (the
        // backend verifies it with the change-password lockout); fresh
        // enrollment stays bodyless (the backend's optional branch).
        headers: enrolled ? jsonHeaders : headers,
        body: enrolled ? JSON.stringify({ current_password: currentPassword }) : undefined,
      });

      import("qrcode").then((QRCode) => {
        QRCode.default.toDataURL(data.otpauth_url, (err: Error | null | undefined, url: string) => {
          if (!err) setSetupData({ ...data, qrCode: url });
        });
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      const message = err instanceof Error ? err.message : "حدث خطأ";
      // R125-I5 (A3-1): belt-and-braces for a failed session probe — the
      // backend's exact gate message means TOTP IS enabled; surface the
      // password field instead of stranding the error with no CTA.
      if (message.includes("كلمة المرور الحالية مطلوبة")) {
        setEnrolled(true);
        setShowRotate(true);
      }
      setError(message);
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
      // R125-I5 (A3-1): the new secret is now verified + enabled —
      // reset the rotate-flow state so a re-render (or a future
      // un-mount/mount) starts from the honest «مفعّلة» status card.
      setEnrolled(true);
      setShowRotate(false);
      setCurrentPassword("");
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    // R126-L5 (A3-4): the success card rides the --status-success
    // ink+tint pair — raw emerald-500 on its /10 tint measured ≈2.4:1
    // on the light theme (A3); the token measures 5.90:1 on white /
    // 4.98:1 on the /12 tint light and ≥9:1 dark (index.css F3-06).
    return (
      <div className="flex flex-col items-center justify-center py-6 px-4 bg-status-success/10 border border-status-success/20 rounded-xl">
        <CheckCircle className="w-12 h-12 text-status-success mb-3" />
        <h3 className="font-bold text-status-success">تم تفعيل المصادقة الثنائية بنجاح</h3>
        <p className="text-sm text-status-success mt-1">حسابك الآن محمي بطبقة إضافية من الأمان.</p>
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
            {/* AUD103-6-F2 / R125-I5 (A6-B13): the 6-digit input was
                placeholder-only — the step heading above is not a
                programmatic label. The sr-only label gives the field an
                accessible name (getByLabelText-resolvable). */}
            <label htmlFor="settings-2fa-verify-code" className="sr-only">
              رمز التحقق المكوّن من 6 أرقام
            </label>
            <input
              id="settings-2fa-verify-code"
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

  // R125-I5 (A3-1 P2): the enrolled branch — a «مفعّلة» status card +
  // the rotate flow (current-password re-auth → fresh QR → verify).
  // Before this, an enrolled admin saw the fresh-enrollment CTA and
  // dead-ended on the backend's S5 400.
  if (enrolled) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div className="w-full flex items-start gap-3 p-4 rounded-xl bg-status-success/8 border border-status-success/25">
          <ShieldCheck className="w-5 h-5 text-status-success shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-bold text-sm text-status-success">المصادقة الثنائية مفعّلة</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              حسابك محمي برمز تحقق من تطبيق المصادقة عند كل تسجيل دخول.
            </p>
          </div>
        </div>

        {showRotate ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void startSetup();
            }}
            className="w-full space-y-3"
          >
            {/* R125-I5: rotation semantics disclosed up front — the S5
                gate exists because overwriting an enabled secret leaves
                2FA OFF until the new code is verified. */}
            <p className="text-xs text-status-warning bg-status-warning/10 border border-status-warning/25 rounded-xl px-3 py-2 leading-relaxed">
              إعادة الإعداد تُصدر مفتاحاً جديداً وتُعطّل الحماية مؤقتاً حتى تفعيل الرمز الجديد —
              أكمل الخطوات حتى النهاية.
            </p>
            <div>
              <label
                htmlFor="settings-2fa-current-password"
                className="text-xs font-bold mb-1 block"
              >
                كلمة المرور الحالية
              </label>
              <input
                id="settings-2fa-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm"
                autoComplete="current-password"
                required
                /* R125-I5: the same lockout as change-password applies to
                   wrong attempts (backend `admin-2fasetup:` key) — the
                   field is the only gate, keep autofill-friendly. */
                dir="ltr"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={loading || !currentPassword}
                className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary/10 text-primary-text font-bold text-sm hover:bg-primary/20 transition-all border border-primary/20 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                متابعة
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRotate(false);
                  setCurrentPassword("");
                  setError("");
                }}
                className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
              >
                إلغاء
              </button>
            </div>
          </form>
        ) : (
          <>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              onClick={() => setShowRotate(true)}
              className="flex items-center gap-2 h-10 px-5 rounded-xl bg-muted/40 text-foreground font-bold text-sm hover:bg-muted/60 transition-all border border-border/60"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة إعداد المصادقة الثنائية
            </button>
          </>
        )}
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
        /* R126-L5 (A3-4): the fresh-enrollment CTA joins its :645 twin
            (fixed R125) on text-primary-text — raw text-primary on the
            /10 tint is 3.56:1 dark (A6-B6's measured figure). */
        className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary/10 text-primary-text font-bold text-sm hover:bg-primary/20 transition-all border border-primary/20"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
        إعداد المصادقة الثنائية
      </button>
    </div>
  );
}
