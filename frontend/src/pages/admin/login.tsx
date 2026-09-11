import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COOKIE_AUTH_SENTINEL, useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useAdminLogin } from "@workspace/api-client-react";
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, Shield } from "lucide-react";
import { useRef, useState } from "react";
import { useLocation } from "wouter";

/** Arabic copy for the (rare) cookie-could-not-be-established failure. */
const SESSION_BOOTSTRAP_FAILED = "تعذّر تثبيت جلسة الإدارة — تحقق من اتصالك ثم أعد المحاولة";

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const { setAdminToken, setAdminPermissions } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");

  const [needs2FA, setNeeds2FA] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  /**
   * 97-F5 (F-08 pattern — Enter guard): synchronous twin of
   * `isVerifying`. A rapid double-Enter (key auto-repeat / impatient
   * operator) can land BOTH submit events inside the same tick — before
   * the state update re-renders the disabled button — so the onSubmit
   * predicate alone would still let the second verify through. The ref
   * closes that sub-tick window.
   */
  const verifyingRef = useRef(false);

  /**
   * 97-F5 (R97-02 coordination — backend 97-F2): /api/admin/login and
   * /api/admin/login/verify-2fa no longer return a `token` in the JSON
   * body. The httpOnly `admin_token` cookie they Set-Cookie is the SOLE
   * session transport (requireAdmin reads the cookie first; the body
   * used to leak a full-session JWT readable from JS memory). This page
   * therefore establishes the in-memory session EXACTLY the way the
   * boot path does (AuthProvider's admin probe): a /api/admin/probe
   * round-trip verifies the cookie actually landed and returns the live
   * admin shape — only then do we set the cookie-session sentinel +
   * permissions and navigate. A cookie that did not round-trip
   * (third-party-cookie blocking, exotic embedding) surfaces an honest
   * inline error instead of navigating into a dead admin gate that
   * would bounce straight back.
   */
  async function establishAdminSession(): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/probe", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return false;
      const body = (await res.json().catch(() => null)) as {
        authenticated?: boolean;
        admin?: { permissions?: unknown } | null;
      } | null;
      if (!body?.authenticated || !body?.admin) return false;
      setAdminToken(COOKIE_AUTH_SENTINEL);
      setAdminPermissions(
        Array.isArray(body.admin.permissions) ? (body.admin.permissions as string[]) : [],
      );
      return true;
    } catch {
      // Network failure — the operator gets the honest retry copy; the
      // cookie (if it landed) still works on a fresh page load.
      return false;
    }
  }

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess(data) {
        if (data.requires_2fa) {
          setNeeds2FA(true);
          setTempToken(data.temp_token!);
          return;
        }
        // 97-F5 (R97-02): no body token to store — the cookie is the
        // session. Bootstrap the in-memory state from the probe
        // round-trip; navigate only once the cookie is confirmed live.
        void (async () => {
          if (await establishAdminSession()) {
            navigate("/admin");
          } else {
            setError(SESSION_BOOTSTRAP_FAILED);
          }
        })();
      },
      onError(err: unknown) {
        setError(err instanceof Error ? err.message : "حدث خطأ");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 97-F5 (R97-A4 §8 / F-08 — the only <form> in this wave's
    // ownership): Enter inside any text field submits the form
    // REGARDLESS of the submit button's disabled state (implicit
    // submission ignores it), so a double-Enter while the login
    // mutation or the 2FA verify is in flight would re-fire it and layer
    // a 401/timeout error banner over the already-pending attempt. Guard
    // with the EXACT predicate the submit button uses.
    if (loginMutation.isPending || isVerifying) return;
    setError("");
    if (needs2FA) {
      verify2FA();
    } else {
      loginMutation.mutate({ data: { username, password } });
    }
  };

  const verify2FA = async () => {
    // 97-F5 (F-08): same-tick re-entry guard (see verifyingRef above) —
    // the onSubmit predicate only covers post-render Enters.
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setIsVerifying(true);
    // 96-F7 (R96 M18): 2FA verify errors now render INLINE with the
    // exact same visual treatment as the password errors (the #error
    // block below) — the old toast-only path made the same form show
    // two different error experiences, and the toast vanished under
    // the keyboard on mobile.
    setError("");
    try {
      const res = await fetch("/api/admin/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp_token: tempToken, code: otpCode }),
      });
      // 96-F7 (R96 M18): parse AFTER the ok guard — a non-JSON error
      // body (proxy HTML on a 502) used to throw an opaque English
      // SyntaxError into the error surface.
      // 97-F5 (R97-02): the body no longer carries a `token` — a 2xx
      // alone means the httpOnly cookie was Set-Cookied; the session
      // state comes from establishAdminSession()'s probe below.
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        permissions?: string[];
      } | null;
      if (!res.ok) {
        // Round-4 (org §6a) pattern: map the backend `code`/`error` to
        // Arabic via getErrorMessage; raw English never reaches the
        // operator.
        throw new Error(getErrorMessage(data) || "رمز التحقق غير صحيح أو منتهي الصلاحية");
      }

      // Cookie confirmed via the probe round-trip (see R97-02 note
      // above) — the sentinel + permissions replace the old body-token
      // storage, then the operator lands in the panel.
      const established = await establishAdminSession();
      if (!established) {
        throw new Error(SESSION_BOOTSTRAP_FAILED);
      }
      navigate("/admin");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "فشلت العملية");
    } finally {
      verifyingRef.current = false;
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 bg-gradient-to-bl from-primary/5 via-background to-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mx-auto flex items-center justify-center mb-4 shadow-lg shadow-primary/10">
            {needs2FA ? (
              <KeyRound className="w-7 h-7 text-primary" />
            ) : (
              <Shield className="w-7 h-7 text-primary" />
            )}
          </div>
          <h1 className="text-xl font-black">{needs2FA ? "المصادقة الثنائية" : "لوحة الإدارة"}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {needs2FA
              ? "الرجاء إدخال رمز التحقق من تطبيق Authenticator"
              : "SubNation — وصول مقيد للمسؤولين"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/10">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!needs2FA ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="username">اسم المستخدم</Label>
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    dir="ltr"
                    className="text-left h-11"
                    aria-describedby={error ? "admin-login-error" : undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">كلمة المرور</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPass ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-10 h-11"
                      aria-describedby={error ? "admin-login-error" : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="otpCode">رمز التحقق (6 أرقام)</Label>
                <Input
                  id="otpCode"
                  name="otpCode"
                  type="text"
                  autoComplete="one-time-code"
                  /* 96-F7 (R96 M6): numeric keypad on mobile for the
                     6-digit TOTP — Android opened a full QWERTY keyboard
                     on every admin login from a phone. */
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  dir="ltr"
                  className="text-center h-11 tracking-widest text-lg font-mono"
                  aria-describedby={error ? "admin-login-error" : undefined}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div
                id="admin-login-error"
                role="alert"
                aria-live="polite"
                className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
              disabled={loginMutation.isPending || isVerifying}
            >
              {loginMutation.isPending || isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جارٍ التحقق...
                </>
              ) : needs2FA ? (
                "تأكيد الدخول"
              ) : (
                "دخول الإدارة"
              )}
            </Button>

            {needs2FA && (
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setNeeds2FA(false);
                  setOtpCode("");
                  setError("");
                }}
              >
                العودة لتسجيل الدخول
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
