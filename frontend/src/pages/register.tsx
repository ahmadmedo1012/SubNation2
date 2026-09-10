import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { WhatsAppPhoneSignIn } from "@/components/WhatsAppPhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { usePublicAuthProviders } from "@/hooks/use-public-auth-providers";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle, Gift } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";

/**
 * Public register page — passwordless.
 *
 * Identical auth surface to /login (Google + Telegram + WhatsApp OTP).
 * The only differences from /login:
 *   - active tab on "حساب جديد"
 *   - referral context banner reading ?ref= from URL
 *   - copy emphasises account creation over sign-in
 *
 * All auth paths read `?ref=` from the URL on the client side and pass
 * it to their respective backend session endpoints — no separate form
 * field is needed.
 */

function readReferralFromUrl(): string {
  if (typeof window === "undefined") return "";
  const ref = new URLSearchParams(window.location.search).get("ref");
  return (ref ?? "").trim().toUpperCase().slice(0, 16);
}

export default function RegisterPage() {
  const referral = useMemo(() => readReferralFromUrl(), []);
  const { whatsappEnabled, whatsappStatus } = usePublicAuthProviders();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative overflow-hidden bg-background">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] left-[15%] w-80 h-80 bg-primary/5 rounded-full blur-[80px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] right-[10%] w-64 h-64 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6 reveal-up">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
          <h1 className="sr-only">إنشاء حساب جديد في SubNation</h1>
        </div>

        {/* Tabs — clear login vs register */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/30 border border-border/40 rounded-2xl mb-5 reveal-up stagger-1">
          <Link
            href="/login"
            className="py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors text-center"
          >
            تسجيل الدخول
          </Link>
          <button
            type="button"
            className="py-2.5 rounded-xl text-sm font-bold bg-card text-foreground shadow-sm cursor-default"
            aria-current="page"
          >
            حساب جديد
          </button>
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 shadow-2xl shadow-black/20 reveal-up stagger-2">
          <AuthErrorBanner />

          {/* Referral context banner — emerald + check when applied,
              soft tip when no ?ref= in URL. Both auth paths read the
              URL ref independently, so this is purely for user feedback. */}
          {referral ? (
            <div
              role="status"
              aria-live="polite"
              className="mb-5 p-3 bg-status-success/8 border border-status-success/22 rounded-xl text-sm text-status-success flex items-center gap-2.5"
            >
              <div className="w-7 h-7 rounded-lg bg-status-success/15 border border-status-success/20 flex items-center justify-center shrink-0">
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold leading-tight">
                  تم تطبيق رمز الإحالة:{" "}
                  <span dir="ltr" className="font-mono tracking-wider">
                    {referral}
                  </span>
                </p>
                {/* R94-A1 #6 (P2): the welcome bonus is credited AT SIGNUP
                    (Google/WhatsApp — backend firebase-auth.service.ts:476 /
                    whatsapp-otp.service.ts:402), NOT "عند الشحن الأول" as
                    the old copy claimed — a referred buyer completing
                    signup never saw the promised topup trigger and assumed
                    the bonus was lost. Wording now matches support.tsx's
                    FAQ (فور التسجيل). */}
                {/* 96-F6 (R96 A6 #18 + #12): formatCurrency(5) — the
                    hardcoded «5 د.ل» violated the money convention
                    (2 decimals + thousands grouping, single-sourced in
                    lib/utils.ts); the /80 opacity also failed AA
                    (≈4.0:1) on small text in light mode. */}
                <p className="text-[11px] text-status-success mt-0.5">
                  ستُضاف مكافأة ترحيب <span className="font-bold">{formatCurrency(5)}</span> إلى
                  محفظتك فور إتمام التسجيل
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-5 p-2.5 bg-status-success/8 border border-status-success/18 rounded-xl text-xs text-status-success flex items-center gap-2">
              <Gift className="w-3.5 h-3.5 shrink-0" />
              {/* R94-A1 #6 (P2): the REFERRER earns 50 loyalty points
                  (POINTS_PER_REFERRAL = 50 ≙ 0.50 د.ل, credited when the
                  friend completes a first topup — topup.service.ts:353),
                  NOT 5 د.ل. Unified with referrals.tsx / loyalty.tsx
                  (نقاط قابلة للتحويل إلى رصيد). */}
              <span>
                ادعُ صديقاً واحصل على{" "}
                <span className="font-bold">50 نقطة ولاء</span> عند أول شحن له — قابلة للتحويل
                إلى رصيد
              </span>
            </div>
          )}

          {/* PRIMARY: One-click providers (Google + Telegram when enabled).
              Each is fully independent — no shared state, no shared form,
              no implicit dependency on the phone OTP path below. */}
          <AuthProviders />

          {/* WhatsApp — peer of Google + Telegram. Pristine button →
              expands inline. Backend handles new + returning users
              identically (findOrCreateWhatsAppUser). No divider. */}
          {whatsappEnabled && (
            <div className="mt-2.5">
              <WhatsAppPhoneSignIn channelStatus={whatsappStatus} />
            </div>
          )}

          {/* Legacy Firebase Phone OTP block was removed in this commit.
              Phone authentication now flows exclusively through WhatsApp OTP
              above. Telegram + Google remain available via <AuthProviders />. */}
        </div>

        {/* Footer link to login */}
        <p className="mt-5 text-center text-sm text-muted-foreground reveal-up stagger-3">
          لديك حساب بالفعل؟{" "}
          <Link
            href="/login"
            className="text-primary font-bold hover:text-primary/80 transition-colors"
          >
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
