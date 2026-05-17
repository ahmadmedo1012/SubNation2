import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { Link } from "wouter";

/**
 * Public login page — passwordless.
 *
 * Available auth methods:
 *   1. Phone OTP (Firebase) — primary, biggest CTA
 *   2. Google Sign-In        — via AuthProviders (Firebase popup)
 *   3. Telegram              — via AuthProviders (when enabled in
 *                              `auth.telegram` admin setting + a real
 *                              TELEGRAM_BOT_TOKEN is provisioned)
 *
 * Password-first UX has been removed from the public flow as the
 * platform moves to a passwordless model. The backend `/api/auth/login`
 * + `/api/auth/forgot-password` + `/api/auth/reset-password` endpoints
 * are unchanged so legacy users with passwords can still recover via
 * the existing `/forgot-password` deep link, and `/api/auth/change-password`
 * + `/api/auth/toggle-password-login` continue to power the
 * profile-page "set / disable password" controls.
 *
 * Bug-fix benefit: removing the react-hook-form-driven phone field
 * eliminates the `{...register("phone")} onChange={handlePhoneChange}`
 * override that was silently breaking validation ("phone appears
 * filled but validator says required"). FirebasePhoneSignIn uses pure
 * controlled state with no equivalent issue.
 */
export default function LoginPage() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 relative overflow-hidden bg-background">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] right-[15%] w-96 h-96 bg-primary/5 rounded-full blur-[90px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] left-[10%] w-72 h-72 bg-primary/4 rounded-full blur-[70px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-25 pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6 reveal-up">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
        </div>

        {/* Tabs — clear login vs register */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/30 border border-border/40 rounded-2xl mb-5 reveal-up stagger-1">
          <button
            type="button"
            className="py-2.5 rounded-xl text-sm font-bold bg-card text-foreground shadow-sm cursor-default"
            aria-current="page"
          >
            تسجيل الدخول
          </button>
          <Link
            href="/register"
            className="py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors text-center"
          >
            حساب جديد
          </Link>
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 shadow-2xl shadow-black/25 reveal-up stagger-2">
          <AuthErrorBanner />

          {/* PRIMARY: Phone OTP */}
          <div className="space-y-2">
            <div className="text-center">
              <p className="text-sm font-bold">تسجيل الدخول برقم الهاتف</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                نرسل لك رمز تحقق عبر رسالة نصية
              </p>
            </div>
            <FirebasePhoneSignIn />
          </div>

          {/* Single divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border/50" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">أو</span>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {/* SECONDARY: Google + Telegram (when enabled in admin settings) */}
          <AuthProviders />
        </div>

        {/* Footer link to register */}
        <p className="mt-5 text-center text-sm text-muted-foreground reveal-up stagger-3">
          ليس لديك حساب؟{" "}
          <Link
            href="/register"
            className="text-primary font-bold hover:text-primary/80 transition-colors"
          >
            إنشاء حساب جديد
          </Link>
        </p>
      </div>
    </div>
  );
}
