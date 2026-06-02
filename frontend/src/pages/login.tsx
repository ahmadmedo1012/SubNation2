import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { WhatsAppPhoneSignIn } from "@/components/WhatsAppPhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { usePublicAuthProviders } from "@/hooks/use-public-auth-providers";
import { Gift, ShieldCheck, ShoppingBag } from "lucide-react";
import { useMemo } from "react";
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
 *
 * ── Intent-aware value prop ────────────────────────────────────────
 * When a guest taps "اشترِ الآن" on a product, the product page
 * passes `?intent=buy&product=<slug>` so we can show a contextual
 * "you're signing in to buy <product>" message instead of a cold
 * "sign in" prompt — the cold variant has the highest bounce.
 */

interface LoginIntent {
  type: "buy" | "generic";
  productName?: string;
}

function readLoginIntent(): LoginIntent {
  if (typeof window === "undefined") return { type: "generic" };
  const params = new URLSearchParams(window.location.search);
  if (params.get("intent") === "buy") {
    const productName = params.get("product")?.slice(0, 80) ?? undefined;
    return { type: "buy", productName };
  }
  return { type: "generic" };
}

export default function LoginPage() {
  const { whatsappEnabled } = usePublicAuthProviders();
  const intent = useMemo(() => readLoginIntent(), []);
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

          {/* Value-prop banner. Buy-intent variant is highest-conversion:
              it tells the user exactly why they're here ("to finish buying
              X") instead of a cold "log in to use the app" prompt.
              Generic variant lists the three things signing in unlocks. */}
          {intent.type === "buy" ? (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 p-3 bg-primary/8 border border-primary/22 rounded-xl text-sm text-primary-text flex items-center gap-2.5"
            >
              <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/22 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold leading-tight">
                  {intent.productName
                    ? `سجّل دخولك لإكمال شراء "${intent.productName}"`
                    : "سجّل دخولك لإكمال عملية الشراء"}
                </p>
                <p className="text-[11px] text-primary-text/75 mt-0.5">
                  ثوانٍ معدودة بدون كلمة مرور
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-4 grid grid-cols-3 gap-1.5">
              <ValueChip icon={ShoppingBag} label="تسوّق فوري" />
              <ValueChip icon={ShieldCheck} label="محفظة آمنة" />
              <ValueChip icon={Gift} label="5 د.ل عند الإحالة" />
            </div>
          )}

          {/* PRIMARY: One-click providers (Google + Telegram when enabled). */}
          <AuthProviders />

          {/* WhatsApp — peer of Google + Telegram. Pristine button →
              expands inline. Backend handles new + returning users
              identically (findOrCreateWhatsAppUser). No divider. */}
          {whatsappEnabled && (
            <div className="mt-2.5">
              <WhatsAppPhoneSignIn />
            </div>
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

function ValueChip({ icon: Icon, label }: { icon: typeof ShoppingBag; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-2 bg-muted/25 border border-border/40 rounded-lg text-center">
      <Icon className="w-3.5 h-3.5 text-primary-text" aria-hidden="true" />
      <span className="text-[10px] font-bold text-foreground/80 leading-tight">{label}</span>
    </div>
  );
}
