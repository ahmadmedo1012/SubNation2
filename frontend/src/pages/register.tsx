import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { WhatsAppPhoneSignIn } from "@/components/WhatsAppPhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { usePublicAuthProviders } from "@/hooks/use-public-auth-providers";
import { useOnScreen } from "@/hooks/use-on-screen";
import { formatCurrency, sanitizeInternalPath } from "@/lib/utils";
import { CheckCircle, Gift } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link, useLocation } from "wouter";

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
  /* R123-E4a (P2 — the register half of the funnel return path): the
     login page forwards its SANITIZED ?redirect= here when a guest on
     /login?redirect=/checkout (or a product buy-intent link) switches
     to «حساب جديد». Read it with the SAME guard (lib/utils
     sanitizeInternalPath — slash-prefix + //reject + same-origin) and
     thread it to every auth surface, so registering (not just logging
     in) returns the user to the checkout/product they came for. */
  const redirectTarget = useMemo(
    () => sanitizeInternalPath(new URLSearchParams(window.location.search).get("redirect")),
    [],
  );
  const [, navigate] = useLocation();
  const handleRegisterSuccess = useCallback(() => {
    if (redirectTarget) navigate(redirectTarget);
  }, [redirectTarget, navigate]);
  const { whatsappEnabled, whatsappStatus } = usePublicAuthProviders();
  // R115-A10: pause the ambient blobs when the auth card scrolls away.
  const glow = useOnScreen<HTMLDivElement>();

  return (
    <div
      ref={glow.ref}
      className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative overflow-hidden bg-background"
    >
      {/* Ambient background glows */}
      <div
        className="absolute top-[-10%] left-[15%] w-80 h-80 bg-primary/5 rounded-full blur-[80px] pointer-events-none blob-drift"
        style={glow.style}
      />
      <div
        className="absolute bottom-[-5%] right-[10%] w-64 h-64 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow"
        style={glow.style}
      />
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
        {/* A3-F4 (R120-B2): both tabs min-h-11 (44px) — mirrors login.tsx
            (the strip measured 172×40 live on /login). */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/30 border border-border/40 rounded-2xl mb-5 reveal-up stagger-1">
          <Link
            href={
              redirectTarget ? `/login?redirect=${encodeURIComponent(redirectTarget)}` : "/login"
            }
            className="min-h-11 flex items-center justify-center py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors text-center"
          >
            تسجيل الدخول
          </Link>
          <button
            type="button"
            className="min-h-11 flex items-center justify-center py-2.5 rounded-xl text-sm font-bold bg-card text-foreground shadow-sm cursor-default"
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
                  {/* R122 (A1 P2-4): tracking-wider was a silent no-op — the
                      global Arabic letter-spacing guard (index.css:917)
                      zeroes the five tracking utilities app-wide, so this
                      LTR mono code chip rendered with 0 spacing while the
                      same code on /referrals had 0.2em. Arbitrary form
                      unified to tracking-[0.2em]. */}
                  <span dir="ltr" className="font-mono tracking-[0.2em]">
                    {referral}
                  </span>
                </p>
                {/* R115 (welcome-bonus policy B, A8 P1): the promise used
                    to say the 5 LYD lands «فور إتمام التسجيل» — true only
                    for Google/WhatsApp referrals pre-R115 and NEVER for
                    Telegram. Unified policy: the referred user's welcome
                    credit + the referrer's points BOTH land when the
                    friend's FIRST topup is APPROVED (topup.service.ts —
                    manual approval is the fraud gate), on every channel.
                    The banner now states the trigger honestly; the detail
                    line names each side's reward. */}
                <p className="text-2xs text-status-success mt-0.5">
                  عند أول شحن معتمد عبر كود إحالة تحصل أنت وصديقك على مكافآت
                </p>
                <p className="text-2xs text-status-success mt-0.5 leading-relaxed">
                  تحصل أنت على <span className="font-bold">{formatCurrency(5)}</span> رصيد، ويحصل
                  صديقك على <span className="font-bold">50 نقطة</span> عند اعتماد أول شحن لك
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-5 p-2.5 bg-status-success/8 border border-status-success/18 rounded-xl text-xs text-status-success flex items-center gap-2">
              <Gift className="w-3.5 h-3.5 shrink-0" />
              {/* R94-A1 #6 (P2): the REFERRER earns 50 loyalty points
                  (POINTS_PER_REFERRAL = 50 ≙ 0.50 د.ل, credited when the
                  friend's first topup is APPROVED — topup.service.ts),
                  NOT 5 د.ل. Unified with referrals.tsx / loyalty.tsx
                  (نقاط قابلة للتحويل إلى رصيد). R115 (policy B): «اعتماد»
                  added — a rejected first topup never credits. */}
              <span>
                ادعُ صديقاً واحصل على <span className="font-bold">50 نقطة ولاء</span> عند اعتماد أول
                شحن له — قابلة للتحويل إلى رصيد
              </span>
            </div>
          )}

          {/* PRIMARY: One-click providers (Google + Telegram when enabled).
              Each is fully independent — no shared state, no shared form,
              no implicit dependency on the phone OTP path below.
              R123-E4a (P2): onSuccess threads the sanitized ?redirect=
              target (login.tsx's idiom) — without it a funnel register
              always landed on "/" and lost the checkout/product return
              path. */}
          <AuthProviders onSuccess={redirectTarget ? handleRegisterSuccess : undefined} />

          {/* WhatsApp — peer of Google + Telegram. Pristine button →
              expands inline. Backend handles new + returning users
              identically (findOrCreateWhatsAppUser). No divider.
              R123-E4a (P2): same onSuccess threading as AuthProviders
              above — the phone-first path (the majority provider in
              Libya) is exactly where the funnel return path used to
              die for registrants. */}
          {whatsappEnabled && (
            <div className="mt-2.5">
              <WhatsAppPhoneSignIn
                channelStatus={whatsappStatus}
                onSuccess={redirectTarget ? handleRegisterSuccess : undefined}
              />
            </div>
          )}

          {/* R124-I4 (A1 F13): registration — the moment the account
              (wallet, points, referral balance) is created — never
              surfaced the governing terms: the auth pages are
              chrome-free (Footer returns null on /register) and
              checkout's consent line was the funnel's only one.
              Reuses the checkout consent idiom (checkout.tsx) — an
              informational link, no forced-checkbox gate on the
              passwordless provider flow. */}
          <p className="text-2xs text-muted-foreground text-center mt-4 leading-relaxed">
            بإنشاء حسابك فإنك توافق على{" "}
            <Link
              href="/terms"
              className="text-primary-text font-bold underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              الشروط والأحكام
            </Link>
          </p>

          {/* Legacy Firebase Phone OTP block was removed in this commit.
              Phone authentication now flows exclusively through WhatsApp OTP
              above. Telegram + Google remain available via <AuthProviders />. */}
        </div>

        {/* Footer link to login */}
        <p className="mt-5 text-center text-sm text-muted-foreground reveal-up stagger-3">
          لديك حساب بالفعل؟{" "}
          <Link
            href={
              redirectTarget ? `/login?redirect=${encodeURIComponent(redirectTarget)}` : "/login"
            }
            /* R124-I4 (A5 #1/#10): text-primary is the surface token
               (~3.9:1 dark) — the text-safe twin is text-primary-text
               (the Button link variant's own convention, button.tsx).
               Resting underline + hover:opacity-80 = the checkout
               error-link idiom, so the link is not color-alone. */
            className="text-primary-text font-bold underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
