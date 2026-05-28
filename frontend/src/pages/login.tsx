import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { WhatsAppPhoneSignIn } from "@/components/WhatsAppPhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { usePublicAuthProviders } from "@/hooks/use-public-auth-providers";
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
 * The platform is fully passwordless: Phone OTP / Google / Telegram are
 * the only supported flows. Legacy password endpoints (login, register,
 * forgot-password, reset-password, change-password, toggle-password-login)
 * have been removed.
 *
 * Bug-fix benefit: removing the react-hook-form-driven phone field
 * eliminates the `{...register("phone")} onChange={handlePhoneChange}`
 * override that was silently breaking validation ("phone appears
 * filled but validator says required"). FirebasePhoneSignIn uses pure
 * controlled state with no equivalent issue.
 */
export default function LoginPage() {
  const { whatsappEnabled, phoneAuthEnabled } = usePublicAuthProviders();
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

          {/* PRIMARY: One-click providers (Google + Telegram when enabled).
              Each is fully independent — no shared state, no shared form,
              no implicit dependency on the phone OTP path below. */}
          <AuthProviders />

          {/* Single divider — the phone form is a peer option, not a
              fallback. Wording makes the independence explicit. */}
          {/* WhatsApp — visually a peer of Google + Telegram. The component
              starts pristine (single "Continue with WhatsApp" button) and
              expands inline on click. The backend's findOrCreateWhatsAppUser
              handles new + returning users identically — the user never
              has to choose "register" vs "login". No divider needed. */}
          {whatsappEnabled && (
            <div className="mt-2.5">
              <WhatsAppPhoneSignIn />
            </div>
          )}

          {/* Legacy Firebase Phone OTP — only when explicitly re-enabled
              via PHONE_AUTH_ENABLED=true on the backend. Default OFF.
              Kept behind a divider since it is a semantically distinct
              two-step phone form, not a one-click provider. */}
          {phoneAuthEnabled && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-border/50" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  أو سجّل برقم الهاتف
                </span>
                <div className="flex-1 h-px bg-border/50" />
              </div>
              <FirebasePhoneSignIn />
            </>
          )}
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
