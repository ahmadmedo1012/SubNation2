import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { WhatsAppPhoneSignIn } from "@/components/WhatsAppPhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { usePublicAuthProviders } from "@/hooks/use-public-auth-providers";
import { Link } from "wouter";

/**
 * Public login page — passwordless.
 *
 * Available auth methods:
 *   1. Google Sign-In  — via <AuthProviders /> (Firebase popup)
 *   2. Telegram        — via <AuthProviders /> (when enabled in
 *                        `auth.telegram` admin setting + a real
 *                        TELEGRAM_BOT_TOKEN is provisioned)
 *   3. WhatsApp OTP    — via <WhatsAppPhoneSignIn /> (pristine button
 *                        → phone → 6-digit code; backend handles new
 *                        + returning users identically)
 *
 * The platform is fully passwordless. Firebase Phone OTP has been
 * permanently retired — the WhatsApp OTP flow is the sole phone-based
 * sign-in path.
 */
export default function LoginPage() {
  const { whatsappEnabled } = usePublicAuthProviders();
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

          {/* Legacy Firebase Phone OTP block was removed in this commit.
              Phone authentication now flows exclusively through WhatsApp OTP
              above. Telegram + Google remain available as one-click providers
              via <AuthProviders /> at the top of this card. */}
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
